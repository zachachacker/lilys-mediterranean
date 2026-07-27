# Wednesday go-live — the only page you need at the counter

Follow this top to bottom. **Step 0 must succeed before anything else means what it
says.** If anything reads wrong, Step 10 is the abort and nothing is lost by using it.

**Wednesday is Lily's closed day.** Handled in Step 7 — not optional.

---

## Before you leave — what you must have with you

**From Kareem, on the day:**

1. `square_access_token` — Square Dashboard → Developer → your app → **Production**
2. `square_location_id` — same screen
3. `square_webhook_signature_key` — from Step 3, after adding the webhook endpoint

**From you:**

4. The **real domain** for `site_url`, if the domain cuts over the same day
5. A **Resend API key** and the email that should receive order alerts
   (free at resend.com, ~2 minutes) — **get this before you travel**, it is Step 2
   and it is the alarm that catches the two worst mistakes

**Already done, nothing to do:** menu synced (81 items, prices verified against the
printed menu), `payment_provider` already `square`, site/ordering/kitchen screen/print
menus all built and tested, nothing yet deployed on anything of Kareem's.

---

## Step 0 — Deploy the fixed checkout, and prove it landed

Deploy `create-checkout` (commit `e403f71`). Until this is live, a half-finished
credential paste **silently serves demo mode** — a site that looks completely live
and charges nobody. After it, the same mistake **refuses loudly with a 503** instead.

Everything below assumes the fixed version is live. **Prove it before continuing:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/create-checkout" \
  -H "Authorization: Bearer <anon key from data.js>" -H "Content-Type: application/json" \
  -d '{"items":[],"name":"Deploy probe","phone":"3213124444"}'
```

- **`503`** → fixed version is live. Continue. (Ordering is now *down* until Step 5 —
  that is expected and it is why this is the same morning, not earlier.)
- **`400`** → old version still live. The deploy did not take. **Do not continue.**

This probe creates no order either way.

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

## Step 2 — Connect Resend (before the credentials, deliberately)

```sql
update app_config set value = 're_…'          where key = 'resend_api_key';
update app_config set value = 'you@email.com'  where key = 'notify_email';
```

**Why this comes first.** The per-order email prefixes its subject with `[TEST]`
whenever the order is a demo order. That makes it the one *automatic* detector of
both disasters: if you are accidentally still in demo mode, the alarm literally
arrives in your inbox saying `[TEST]`. Connect it afterwards and no alarm exists
during the exact window the system is most likely to be half-configured.

Use **your own** email first — until a sending domain is verified, Resend only
delivers to the account owner.

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

## Step 7 — Let your test order through on a closed day

Real orders are refused outside opening hours and **Wednesday is closed**
(`HOURS` day 3 is `null` in `create-checkout`). Without this, your own test card is
refused at the counter.

*A narrower mechanism may replace this — one that lets your test through without
opening the shop to the public. If it has landed, use that instead.* Otherwise, the
blunt version: set day `3` to `[11, 22]` in `create-checkout`, redeploy, and revert
immediately after Step 9.

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

## Step 9 — Refund it, and revert the hours

Refund in **Square Dashboard → Transactions**. Not on the tablet — cancelling a
ticket does **not** return money.

Then revert Step 7 and **see the closed message with your own eyes**: try to order
on the site; it must say *"We're closed right now — online ordering opens with the
kitchen."* If it takes the order, the revert did not deploy. Do not leave until
you have seen that message.

## Step 10 — ABORT

Abort if: Step 0 does not return 503 · Step 6 reads false and you cannot fix it
there · Step 8 shows `demo = true` · Step 8 stays `pending` past a minute · you
cannot confirm the Step 9 revert.

**How to abort safely — this changed with the Step 0 deploy.** Blanking the access
token alone now leaves the site **503, ordering offline**. To return it to a working
demo-mode site, blank the *provider*:

```sql
update app_config set value = '' where key = 'payment_provider';
```

That makes the system stop believing it should be live, so it serves demo mode —
charging nobody — while you sort things out. Then revert Step 7's hours.

Aborting costs a day. Going live half-configured costs Kareem real food.

---

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

---

## The one line to remember

> Deploy and see the **503** → grants → Resend → all three values → gate reads **true**
> → real order flips to **paid**, not just `demo = false` → refund in **Square** →
> revert the hours and **see the closed message**.
> Abort by blanking `payment_provider`, not the token.
