> **SUPERSEDED 2026-09-22.** Online ordering now runs through Kareem's SkyTab
> (`data.js` → `orderUrl`). The custom checkout is dormant: nothing on the site
> links to it and `order.html` redirects to SkyTab. This page applies only if the
> custom checkout is ever revived. Do not paste Square or Stripe credentials
> because of anything written below.

# Go-live — the only page you need at the counter

*(Filename still says Wednesday for historical reasons — other documents point at it.
The procedure below works on any day.)*

Follow this top to bottom. **Step 0 must succeed before anything else means what it
says.** If anything reads wrong, Step 10 is the abort and nothing is lost by using it.

**First, check the clock in Florida.** Real orders are refused outside opening hours,
so whether you need Step 7 depends entirely on when you test:

| Florida local time | Lily's | Step 7 |
|---|---|---|
| Mon, Tue, Thu 11:00–22:00 · Fri, Sat 11:00–23:00 · Sun 11:00–22:00 | **open** | **skip it** |
| any Wednesday, or outside those hours | **closed** | **required** |

**Don't convert in your head — the day changes too, not just the hour.** Between
midnight and ~06:00 where you are, Florida is still on *yesterday*. Get both from one
place:

```bash
TZ=America/New_York date "+%A %H:%M"
```

Use that weekday and that time in the table above, and nothing else.

---

## Before you leave — what you must have with you

**From Kareem, on the day:**

1. `square_access_token` — Square Dashboard → Developer → your app → **Production**
2. `square_location_id` — same screen
3. `square_webhook_signature_key` — from Step 3, after adding the webhook endpoint

**From you:**

4. The **real domain** for `site_url`, if the domain cuts over the same day
5. *(Nothing else. Email alerts are deferred — see Step 2.)*

**Already done, nothing to do:** menu synced (81 items, prices verified against the
printed menu), `payment_provider` already `square`, site/ordering/kitchen screen/print
menus all built and tested, nothing yet deployed on anything of Kareem's.

---

## Step 0 — Deploy the fixed checkout, and prove it landed

Deploy `create-checkout` (commit `e403f71`). Until this is live, a half-finished
credential paste **silently serves demo mode** — a site that looks completely live
and charges nobody. After it, the same mistake **refuses loudly with a 503** instead.

Everything below assumes the fixed version is live. **Prove it before continuing** —
this is copy-pasteable as-is; the key in it is the public anon key already shipped in
`data.js`, not a secret:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/create-checkout" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5dHZmcXlkYWh3c3JjZGJudmZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDk3NDYsImV4cCI6MjA5OTc4NTc0Nn0.taAfp5xGFYdxyNxeszmxEt5Me-PPNfUbXfs4suLvXt0" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":"deploy-probe-not-a-real-item","qty":1}],"name":"Deploy probe","phone":"3213124444"}'
```

- **`503`** → fixed version is live. Continue. (Ordering is now *down* until the
  credentials land in Step 4 — expected, and why this is the same morning.)
- **`400`** → old version still live. The deploy did not take. **Do not continue.**

The cart is deliberately *structurally valid but names an item that does not exist*.
That matters: an **empty** cart is rejected at `:75`, before the provider guard at
`:109`, so it returns 400 on both versions and can never tell them apart. A valid
cart with an unknown item passes `:75`, hits the guard on the fixed version (**503**),
and on the old version sails past it to the menu lookup and is refused there (**400**).

It creates no order either way — the unknown item is rejected at `:164`, before the
insert. Verified against the live function: returns
`400 "Sorry — an item in your cart isn't available online."`

## Step 1 — Revoke the public write grants (before any SQL-editor work)

Do this *before* you start pasting, not after — it protects the session in which a
mistake would happen.

```sql
revoke insert, update, delete, truncate on public.orders     from anon, authenticated;
revoke insert, update, delete, truncate on public.app_config from anon, authenticated;
revoke insert, update, delete, truncate on public.menu_items from anon, authenticated;
revoke select on public.orders, public.app_config from anon, authenticated;
```

Safe: nothing in the browser touches these tables directly — every read and write
goes through an Edge Function on the service role. Verified.

## Step 2 — Email alerts — DEFERRED, skip today

Zachary's call: order-alert emails are off the critical path for Wednesday. **Do
nothing at this step.** The step number is kept so every reference below still points
where it says it does.

*(The step numbers are deliberately not re-flowed. Renumbering a page like this is how
cross-references go stale, and stale pointers on this page have already caused two
defects.)*

To switch it on later — a five-minute job, any day:

```sql
update app_config set value = 're_…'          where key = 'resend_api_key';
update app_config set value = 'you@email.com'  where key = 'notify_email';
```

**What you give up by deferring** — stated plainly, not as an argument to reverse it:

- **The kitchen tablet is the only place an order appears.** If it sleeps, loses
  Wi-Fi, or nobody is looking, an order can be missed with nothing to catch it.
- **No `[TEST]`-subject detector.** The per-order email prefixes `[TEST]` on demo
  orders, which would have been an automatic "you are still in demo mode" alarm. Its
  value genuinely dropped once Step 0 shipped — the fixed code now refuses a
  half-config loudly with a 503 instead of pretending — so the gate at Step 6 and the
  `demo = false` check at Step 8 cover the same ground manually.
- **The daily digest** goes with it.

*Not affected, despite appearances:* a missed webhook. The email fires when an order
**becomes paid** — a missed webhook means it never becomes paid, so no email would
have fired either way. That exposure is gap 1 and it is unchanged by this decision.

## Step 3 — Register the webhook in Square

Square Dashboard → Developer → Webhooks → Add endpoint.

- URL, **exactly**, no trailing slash:
  `https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/square-webhook`
- Events: `payment.created` **and** `payment.updated`
- Save, then copy the **Signature key**

> The signature is computed over **the URL plus the body**. One wrong character — a
> trailing slash, `http` for `https` — and every real payment fails verification
> while the customer's card is still charged. If Square shows a different URL,
> stop and set `app_config.square_webhook_url` to exactly what Square displays.

## Step 4 — Paste all three values, in one sitting

**Do not stop halfway.**

```sql
update app_config set value = '…access token…'   where key = 'square_access_token';
update app_config set value = '…location id…'    where key = 'square_location_id';
update app_config set value = '…signature key…'  where key = 'square_webhook_signature_key';
```

**Order matters if you are ever setting `payment_provider` in the same batch: set
the provider FIRST, credentials after.** A blank provider skips every refusal guard.
With credentials **partly** set that falls silently to demo mode; with **all three**
set it goes fully live and charges cards. Neither is what you want. Never leave that
combination on the table, even briefly.

All three are required. The signature key is not optional paperwork — without it the
webhook rejects every delivery, so cards get charged while orders sit `pending`
forever, invisible to the kitchen.

## Step 5 — Point the site at the real domain

Square sends the customer here after they pay. Miss it and every paying customer
lands on the GitHub URL for their receipt.

```sql
update app_config set value = 'https://lilysmediterranean.com' where key = 'site_url';
```

No trailing slash. Skip only if the domain is not cutting over today.

## Step 6 — THE GATE. Run it and read it.

```sql
select
  bool_and(is_set) as all_three_set,
  string_agg(case when not is_set then key end, ', ') as still_missing
from (
  select key, (value is not null and value <> '') as is_set
  from app_config
  where key in ('square_access_token','square_location_id','square_webhook_signature_key')
) t;
```

- `all_three_set = true` → continue
- `all_three_set = false` → **STOP.** `still_missing` names what to paste. With Step 0
  deployed the site is refusing orders with a 503 right now, so no customer is being
  harmed — but nobody can order either. Fix it or abort.

## Step 7 — Unlock your test order (ONLY if the kitchen is closed)

**Check the table at the top first.** If Lily's is open when you place the test order,
**skip this entire step** — a normal order goes straight through, and Step 9 loses its
token deletion too. This step exists only for a closed day or out-of-hours test.

Real orders are refused when the kitchen is closed. No code edit, no redeploy: set a
secret, use it once, delete it.

**1. Set the token** (any long random string, **no spaces**):

```sql
insert into app_config (key, value) values ('test_order_token', '<long random string>')
on conflict (key) do update set value = excluded.value;
```

**2. Order normally on the site.** In the **notes box**, the *very first thing* you
type must be:

```
#test:<the same value>
```

Anything after a space becomes an ordinary note. There is no special URL — the
secret never appears in a link, browser history, or the Referer header sent to
Square.

**3. What you should see.** The order rides the **full live path** — real Square
charge, real webhook, real kitchen ticket. It is marked everywhere: order code
`TEST-XXXX` instead of `LM-XXXX` (on the site, the confirmation page and the Square
reference) and `[SYSTEM TEST ORDER]` on the ticket notes. The token itself is
stripped before the order is saved, so the secret never reaches the database or
the kitchen screen.

> **If it is refused with "We're closed right now", the token did not match.** A typo
> looks exactly like the bypass not working. Check the line starts with `#test:` and
> that the value matches the row exactly.
>
> **If you skipped Step 7 and see this, you did not get a token wrong — you got the
> day wrong.** Re-run the clock check at the top.
>
> A wrong **value** with the right `#test:` prefix is stripped and never reaches the
> ticket. A mistyped **prefix** isn't recognised at all — it's treated as an ordinary
> note, so what you typed would be stored and printed. On a closed day the order is
> refused before it's saved; on an open day it isn't.

Generate a fresh value; never reuse one. It lives only in `app_config` — this repo
is publicly served, so no secret can live in code.

## Step 8 — One real order, on a real card

Smallest real item, paid with a real card.

```sql
select code, status, demo, payment_provider, total_cents, provider_order_id, provider_payment_id
from orders order by created_at desc limit 1;
```

Must read:

- `demo = false` — **`true` means you are still in demo mode. Stop, go back to Step 4.**
- `payment_provider = 'square'`
- `status = 'paid'` — **wait for this.** It starts `pending` and flips within seconds
  when the webhook lands. Seeing `demo = false` is *not* enough; if it stays `pending`
  past a minute your webhook URL or signature is wrong → Step 3.
- `provider_order_id` and `provider_payment_id` both filled

Then confirm the ticket appears on the kitchen screen, and that the order email
arrives **without** a `[TEST]` prefix.

## Step 9 — Refund it, and delete the test token

Refund in **Square Dashboard → Transactions**. Not on the tablet — cancelling a
ticket does **not** return money.

Then remove the unlock — **only if you used Step 7**; skip if the kitchen was open:

```sql
delete from app_config where key = 'test_order_token';
```

Confirm it is gone before you walk away:

**Run this check every time, even if you skipped Step 7:**

```sql
select count(*) as token_rows from app_config where key = 'test_order_token';
```

`0` is the only acceptable answer — **stop if it isn't.** This is unconditional on
purpose. A row left behind by an earlier, abandoned attempt grants nothing while the
kitchen is open, so nothing ever reveals it — but it grants real out-of-hours ordering
every night from close until 11:00, and all day Wednesday, indefinitely. The one
moment you would notice is this check, so it runs whether or not you set a token
today.

**Then prove it functionally, not just by counting rows.** Attempt one ordinary
out-of-hours order on the site — no token. It must be refused with *"We're closed
right now."* If it goes through, the bypass is still open. **Do not walk away until
you have seen that refusal.**

> **Worth knowing, and it's your call.** A closed day was quietly doing security work
> nobody designed: between pasting the credentials and confirming the test order,
> nobody *except* the token holder could place a real order. On an open day that lock
> is gone — from Step 4 onward the site takes real money from anyone with the URL, for
> the whole window. Running the sequence before 11:00 Florida time restores it for
> free and keeps Steps 7 and 9, which are already built and reviewed. Or accept the
> window: it is short, and the URL is not public yet.

## Step 10 — ABORT

Abort if: Step 0 does not return 503 · Step 6 reads false and you cannot fix it
there · Step 8 shows `demo = true` · Step 8 stays `pending` past a minute.

**How to abort:**

```sql
update app_config set value = '' where key = 'square_access_token';
```

**Stop there.** No card can be charged after this.

Confirm it: one order attempt returns **"Ordering is temporarily unavailable"**.

*If you are aborting because Step 0 never passed, the old code is still deployed and
you will see a demo order instead. That charges nobody either — you are simply back
where you started. Either way no card can be charged, which is the only thing an
abort has to achieve.*

Then delete the test token (Step 9) if you set one.

> **Do not blank `payment_provider`.** An earlier draft of this page said to, and it
> was wrong in both directions. With the credentials already pasted, blanking it
> skips every refusal guard while `squareReady` stays true — the site remains **fully
> live and keeps charging real cards**, having removed only the guard. Blank the
> token as well and you land in demo mode instead: orders insert as `paid` for `$0`
> and print real tickets for food nobody paid for. Neither is an abort.
>
> `payment_provider` must not be blanked at any point on Wednesday.
>
> It is worth knowing *why* it looks like the right lever, so nobody re-derives it:
> blanking the provider genuinely does return the site to demo mode — **but only
> while all three credential rows are still empty.** That is its state today, which
> is exactly why it reads as safe and tests as safe. The moment a single credential
> exists it inverts into the two failures above. It is a pre-credential convenience,
> never a safety lever.

Aborting costs a day. Going live half-configured costs Kareem real food.

## Known gaps he is accepting on day one

State these to Kareem rather than letting him find them.

1. **No automatic payment recovery on Square.** The 15-minute reconcile job only
   understands Stripe — it filters on `stripe_session_id`, which Square orders never
   have, so it cannot damage them but never examines them either. If a webhook is
   ever missed, nothing sweeps it up. Watch for:
   ```sql
   select count(*) from orders where status='pending' and created_at < now() - interval '15 minutes';
   ```
   Above zero for long means money is landing without orders confirming.

   *Decision: not building this before Wednesday.* An untested recovery path deployed
   two days out adds more risk than the gap it closes. Revisit once the webhook has
   proven itself over a week of real traffic.

2. **A refund in Square is invisible here.** The order reads `paid` forever. Square's
   dashboard is the source of truth for refunds, not the kitchen screen.

3. **A cancelled order can still be paid.** If the kitchen cancels a ticket and the
   customer then pays the link, Square takes the money and the order stays cancelled.
   If anyone says "I paid and you have no order" — check Square → Transactions.

4. **The kitchen board holds real customer names and phone numbers** from the first
   real order. Do not screenshot it, share the screen, or show it at a door once live.
   Use the fake-ticket captures in `~/Projects/demos/kitchen-capture/` instead.

5. **The kitchen tablet is the only place orders appear** — email alerts are
   deferred (Step 2), so there is no backup delivery channel and no daily digest.

   **Self-recovering, and worth knowing why:** the board has no time bound on live
   orders (`paid`, `making`, `ready` persist until someone advances them; only
   finished ones age off after 12 hours). An order that arrives while the tablet is
   asleep or offline is still sitting there when it wakes. The customer waits longer;
   nothing is lost.

   **Say this to Kareem rather than letting him discover it:** *"The tablet is the
   only place orders show up, so someone needs to be watching it during service."*

---

## The one line to remember

> Deploy and see the **503** → grants → all three values → gate reads **true**
> → test token in → real order flips to **paid**, not just `demo = false` → refund in
> **Square** → **delete the test token**.
>
> Abort = blank the **access token** and stop at the 503. Never blank `payment_provider`.
