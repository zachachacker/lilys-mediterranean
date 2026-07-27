# Go-live checklist — turning on real payments (Square)

**Read this before you paste the Square credentials in.** It is self-contained;
you do not need to have read anything else. Doing this wrong does not throw an
error — it silently gives food away. That is the whole reason this page exists.

The site is currently in **demo mode**: it takes "orders" but charges nobody.
Every order lands marked `paid` with `$0` collected. That is fine while no
customers can reach it. The moment real customers can, demo mode = free food.

---

## ⚠️ THE ONE TRAP — partial Square config still gives food away

The code decides "are we live?" with this rule (create-checkout, line ~82):

```
squareReady = (square_access_token is set) AND (square_location_id is set)
```

If **either** of those is missing, `squareReady` is false, the system **silently
falls back to demo mode**, and orders keep landing `paid` for `$0` — now on a
site that looks completely live. There is **no error, no warning, no refusal.**
The "refuse loudly" guard that looks like it should catch this does **not** fire
in this case (verified).

So the danger is the half-finished paste: you set the access token, get
interrupted, and never set the location id (or the webhook signature key). The
site looks done. It is not. It is giving food away.

**Rule: set all three Square values, then run the one check below, then place one
real test order. In that order. Every time.**

The three values that must ALL be non-empty:
1. `square_access_token`
2. `square_location_id`
3. `square_webhook_signature_key`

---

## Step 1 — Get the values from Square (5 min)

In the Square Dashboard:

- **Developer → your application → Production**
  - **Access token** → this is `square_access_token`
  - **Location ID** → this is `square_location_id`
- **Developer → Webhooks → Add endpoint**
  - URL (paste **exactly**, no trailing slash):
    `https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/square-webhook`
  - Events: **`payment.created`** and **`payment.updated`**
  - After saving, copy the **Signature key** → this is `square_webhook_signature_key`

> **The webhook URL must match byte-for-byte.** The signature is computed over the
> URL **plus** the request body. A trailing slash, an `http` instead of `https`,
> or one wrong character means **every real payment fails verification** and the
> order is stuck as unpaid forever — while the customer's card was charged. If
> Square shows a different URL than the one above, set `square_webhook_url` in
> `app_config` to the **exact** URL Square shows.

## Step 2 — Paste all three into the database (one sitting, do not stop halfway)

Supabase Dashboard → SQL Editor. Replace the `…` with the real values:

```sql
update app_config set value = '…access token…'      where key = 'square_access_token';
update app_config set value = '…location id…'        where key = 'square_location_id';
update app_config set value = '…signature key…'      where key = 'square_webhook_signature_key';
-- payment_provider is already 'square' — leave it.
-- Only if Square shows a webhook URL different from the default above:
-- update app_config set value = '…exact url…'       where key = 'square_webhook_url';
```

## Step 2b — Point `site_url` at the real domain (easy to forget)

Square sends the customer to `site_url` after they pay (`create-checkout:181`).
If the production domain goes live and this still holds the GitHub URL, every
paying customer lands on the wrong host for their receipt.

```sql
update app_config set value = 'https://lilysmediterranean.com' where key = 'site_url';
```

No trailing slash. Skip only if the domain is not cutting over yet.

## Step 3 — Run the ALL-THREE check (this is the gate)

Paste this into the SQL Editor. It shows only whether each value is set — never
the value itself:

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

- `all_three_set = true`, `still_missing = null` → **proceed to Step 4.**
- `all_three_set = false` → **STOP.** `still_missing` names what to go back and
  paste. Do not take orders until this reads true. A half-set config is demo mode
  wearing a live costume.

## Step 4 — Place ONE real test order, before any customer does

1. During opening hours (real orders are refused when closed), go to the live
   order page and place the smallest real item as a genuine order.
   > **Lily's is CLOSED on Wednesdays** (`HOURS` day 3 is `null`). On a Wednesday
   > this step is impossible without temporarily opening that day in
   > `create-checkout` and reverting straight after — see `WEDNESDAY-RUNBOOK.md`.
2. Pay it with a **real card** (a $5-ish item; you will refund it in Step 5).
3. Check the database:

```sql
select code, status, demo, payment_provider, total_cents, provider_order_id, provider_payment_id
from orders order by created_at desc limit 1;
```

What you must see:
- `demo = false` ← **if this says `true`, you are still in demo mode. Stop and
  redo Step 2/3.** A `true` here is the trap catching you.
- `payment_provider = 'square'`
- `status = 'paid'` **only after** you completed the card payment (it starts as
  `pending` and flips to `paid` when Square's webhook lands — usually seconds). If
  it stays `pending` after you paid, your webhook URL/signature is wrong
  (revisit Step 1's warning).
- `provider_order_id` and `provider_payment_id` are filled in.

If all of that is right, the money path is live.

## Step 5 — Refund the test order (and know how refunds work)

**Refunds are done in the Square Dashboard, not in this app.** There is no refund
button anywhere in the kitchen screen for Square orders. Refund your test payment
in Square → Transactions.

Know this before you open: **cancelling an order on the kitchen tablet does NOT
refund it.** The tablet's "Cancel this order" only changes the ticket status; the
customer's money stays taken. To give money back you must go to the Square
Dashboard every time. Tell whoever runs the tablet.

---

## After go-live — three gaps to have a plan for

These are not blockers for turning payments on, but they will bite without a
person watching for them:

1. **A cancelled order can still be paid.** If a customer opens the payment link,
   the kitchen cancels the ticket, and the customer then pays, Square takes the
   money but the order stays cancelled and the payment is silently dropped — and
   nothing sweeps Square to catch it. The recovery job only understands Stripe —
   `reconcile` filters on `stripe_session_id`, which Square orders never have, so
   it cannot damage them but never examines them either. If a customer ever says "I paid but you have no order,"
   check Square → Transactions directly.

2. **A refund in Square is invisible to this app.** The order will still read
   `paid` here forever. Your source of truth for "was this refunded" is the Square
   Dashboard, not the kitchen screen or the daily summary email.

3. **No payment outage alarm faster than ~24h.** The only automatic check runs
   once a day. If webhooks break (e.g. the URL trap above), you may not notice for
   a day unless you spot orders piling up as `pending`. Consider glancing at
   `select count(*) from orders where status='pending' and created_at < now() - interval '15 minutes'`
   — anything above zero for long means payments are landing but not confirming.

---

## Optional but recommended hardening (not payment-gating)

Do these when convenient; they are not needed to take payments safely, but they
close real gaps found in the review:

- **Lock down the database grants.** Right now the public API role can, in
  principle, be granted write access to the orders and secrets tables — the only
  thing stopping it today is that no access policy exists (which happens to mean
  "deny all"). That safety is one accidental config change away from flipping. Ask
  whoever set up Supabase to **revoke `insert/update/delete/truncate` from `anon`
  and `authenticated`** on `orders`, `app_config`, `menu_items`. The site does not
  use those; only the server (service role) does.
- **The Edge Function source is publicly downloadable** at the site URL
  (`/supabase/functions/...`). It contains no secrets, but it hands an attacker
  the full server logic and this runbook's structure. If you move the site off the
  shared GitHub Pages repo, keep `supabase/` out of what gets published.
- **Rotate the kitchen tablet key periodically.** It never expires and is typed
  once per tablet; if a tablet is lost, change `app_config.kitchen_key` and
  re-enter it on the real tablets.

---

## One-line summary to tape to the monitor

> Set **all three** Square values → run the all-three check → place **one real
> paid order** and confirm `demo = false` → refund it in **Square** (not the
> tablet). If `demo = true` anywhere, you are giving food away.
