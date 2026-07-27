# Wednesday go-live — the only page you need at the counter

Follow this top to bottom. Do not skip the check in Step 4; it is the one that
stops you giving food away. If anything reads wrong, **Step 7 is the abort** and
nothing is lost by using it.

**Wednesday is Lily's closed day.** That matters — see Step 5. It is handled, but
it is not optional.

---

## Before you leave — what you must have with you

**From Kareem, on the day:**

1. `square_access_token` — Square Dashboard → Developer → your app → **Production**
2. `square_location_id` — same screen
3. `square_webhook_signature_key` — Square Dashboard → Developer → **Webhooks**, after
   adding the endpoint in Step 2

**From you:**

4. The **real domain** you want customers on (e.g. `https://lilysmediterranean.com`),
   if the domain is cutting over the same day
5. A **Resend API key** + the email that should receive order alerts
   (free account at resend.com, 2 minutes) — see Step 6 for why this matters

**Already done, nothing to do:**

- Menu is synced — 81 items, all orderable, prices verified against the printed menu
- `payment_provider` is already set to `square`
- Site, ordering, kitchen screen, print menus all built and tested
- Nothing is deployed on anything of Kareem's yet

---

## Step 1 — Register the webhook in Square

Square Dashboard → Developer → Webhooks → Add endpoint.

- URL, **exactly**, no trailing slash:
  `https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/square-webhook`
- Events: `payment.created` **and** `payment.updated`
- Save, then copy the **Signature key**

> The signature is computed over **the URL plus the body**. One wrong character —
> a trailing slash, `http` instead of `https` — and every real payment fails
> verification while the customer's card is still charged. If Square displays a
> different URL to the one above, stop and set `app_config.square_webhook_url` to
> the exact string Square shows.

## Step 2 — Paste all three values, in one sitting

Supabase → SQL Editor. **Do not stop halfway.** A half-finished paste is the
single most dangerous state this system has.

```sql
update app_config set value = '…access token…'   where key = 'square_access_token';
update app_config set value = '…location id…'    where key = 'square_location_id';
update app_config set value = '…signature key…'  where key = 'square_webhook_signature_key';
```

## Step 3 — Point the site at the real domain

**Do this in the same sitting as Step 2 if the domain is going live today.**
Square sends the customer here after they pay. Miss it and every paying customer
lands on the GitHub URL for their receipt — it looks broken.

```sql
update app_config set value = 'https://lilysmediterranean.com' where key = 'site_url';
```

No trailing slash. Skip this step only if the domain is *not* cutting over today.

## Step 4 — THE GATE. Run this and read it.

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
- `all_three_set = false` → **STOP.** `still_missing` names what to go back and paste.

> Why this is the gate and not a formality: if any one of the three is missing,
> the code resolves to demo mode and the "refuse loudly" guard is **skipped**,
> because that guard only runs when the system already believes it is live.
> Verified in `create-checkout` — a half-set config produces a site that looks
> completely live and charges nobody. There is no error and no warning.

## Step 5 — Open Wednesday temporarily (closed-day workaround)

Real orders are refused outside opening hours (`create-checkout` returns 409), and
**Wednesday is `null` in the hours table**. Without this, your own test card is
refused at the counter.

`supabase/functions/create-checkout/index.ts`, line ~16 — change day `3`:

```ts
// BEFORE
const HOURS: Record<number, [number, number] | null> = { 0: [11, 22], 1: [11, 22], 2: [11, 22], 3: null, 4: [11, 22], 5: [11, 23], 6: [11, 23] };
// AFTER — go-live test only
const HOURS: Record<number, [number, number] | null> = { 0: [11, 22], 1: [11, 22], 2: [11, 22], 3: [11, 22], 4: [11, 22], 5: [11, 23], 6: [11, 23] };
```

Redeploy `create-checkout`. **Revert immediately after Step 6** — change `3` back
to `null` and redeploy again.

**Verify the revert** before you walk away:

```sql
-- must return the closed-message error, not an order
select 'run a real order attempt on the site instead' as check_by_hand;
```

Simplest honest check: try to place an order on the site after reverting. It must
say *"We're closed right now — online ordering opens with the kitchen."* If it
takes the order, the revert did not deploy. **Do not leave the counter until you
have seen that message.**

## Step 6 — One real order, on a real card

Place the smallest real item as a genuine order and pay it.

```sql
select code, status, demo, payment_provider, total_cents, provider_order_id, provider_payment_id
from orders order by created_at desc limit 1;
```

Must read:

- `demo = false` — **if this says `true`, you are still in demo mode. Go back to Step 2.**
- `payment_provider = 'square'`
- `status = 'paid'` — starts `pending`, flips within seconds when the webhook lands.
  **Still `pending` after a minute means the webhook URL or signature is wrong** → Step 1.
- `provider_order_id` and `provider_payment_id` both filled in

Then check the ticket appears on the kitchen screen.

**Refund it in the Square Dashboard → Transactions.** Not on the tablet — cancelling
a ticket on the tablet does **not** return the money.

## Step 7 — ABORT

Abort if **any** of these is true:

- Step 4 reads `all_three_set = false` and you cannot fix it there and then
- Step 6 shows `demo = true`
- Step 6 stays `pending` for more than a minute
- You cannot confirm the Step 5 revert

**How to abort safely:** blank the Square token. That returns the system to demo
mode, where it charges nobody, and no customer can be harmed while you sort it out.

```sql
update app_config set value = '' where key = 'square_access_token';
```

Then revert the Wednesday hours change. Aborting costs you a day. Going live
half-configured costs Kareem real food, and it is invisible while it happens.

---

## Known gaps he is accepting on day one

State these to Kareem rather than letting him find them.

1. **No automatic payment recovery on Square.** The 15-minute reconcile job only
   understands Stripe (it filters on `stripe_session_id`, which Square orders do
   not have). It cannot damage Square orders — it simply never sees them. If a
   webhook is ever missed, nothing sweeps it up. Watch for orders stuck `pending`:
   ```sql
   select count(*) from orders where status='pending' and created_at < now() - interval '15 minutes';
   ```
   Anything above zero for long means money is landing without orders confirming.

   *Decision: not fixing this before Wednesday.* Writing and deploying a Square
   reconciliation path two days out, untested against real Square traffic, adds
   more risk than the gap it closes. Revisit once the webhook has proven itself
   over a week of real orders.

2. **A refund in Square is invisible here.** The order still reads `paid` forever.
   Square's dashboard is the source of truth for refunds, not the kitchen screen.

3. **A cancelled order can still be paid.** If the kitchen cancels a ticket and the
   customer then pays the link, Square takes the money and the order stays
   cancelled. If anyone ever says "I paid and you have no order" — check Square →
   Transactions directly.

4. **Order emails are off** unless Step 5's Resend key is set. Without it the kitchen
   tablet is the *only* place an order appears. If it sleeps, an order can be missed
   with nothing to catch it. Five minutes to set up; strongly worth doing.

---

## The one line to remember

> All three values in → run the gate → `demo = false` on a real order → refund it in
> **Square** → revert the Wednesday hours and **see the closed message with your own eyes**.
> If `demo = true` anywhere, you are giving food away.
