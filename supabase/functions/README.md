# Edge functions — deployed to Supabase project `hytvfqydahwsrcdbnvfq` (lilys-mediterranean)

These are the canonical copies of the deployed functions. If you edit one,
redeploy it (Supabase MCP `deploy_edge_function`, or `supabase functions deploy <name>`).

- `create-checkout` — validates the cart against `menu_items` (server-side prices),
  creates the order row + Stripe Checkout session. **Demo mode**: with no Stripe key
  configured, orders are created as `paid` immediately (marked `demo`) so the whole
  flow can be shown without charging anyone.
- `stripe-webhook` — verifies the Stripe signature, marks orders paid/canceled.
  Deployed with `verify_jwt=false` (Stripe can't send a Supabase JWT); the HMAC
  signature check is the auth.
- `order-status` — order lookup for the confirmation page, keyed by the unguessable
  session id.
- `kitchen-api` — list + advance orders for kitchen.html. Requires the
  `x-kitchen-key` header matching `app_config.kitchen_key`. Transition map allows
  one-step undo/recall (see ALLOWED_FROM).
- `reconcile` — safety net under the webhook: every 15 min (pg_cron job
  `reconcile-orders`) it checks orders stuck in `pending` against Stripe and
  recovers missed payments / cancels expired sessions. Dormant in demo mode.
- `notify-order` — email-per-order backup channel behind the kitchen tablet.
  Fired by DB triggers (`orders_notify_insert` / `orders_notify_update`) whenever
  an order becomes paid. Dormant until configured (below). Idempotent via
  `orders.notified_at`; skips orders older than 1h so enabling it never back-spams.

## Payment provider — Square (chosen 2026-07-25) or Stripe

`app_config.payment_provider` = `square` | `stripe`. With neither provider's
credentials filled in, ordering stays in DEMO mode (orders create as paid so
the flow can be demoed). Demo is never a silent fallback from an error.

**To switch Square on (do this on the call with Kareem):**
1. Square Dashboard → Developer → your app → **Production access token** and
   **Location ID**.
2. `update app_config set value='<token>' where key='square_access_token';`
   `update app_config set value='<location id>' where key='square_location_id';`
3. Square Dashboard → Webhooks → add subscription:
   - URL `https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/square-webhook`
   - events: `payment.created`, `payment.updated`
   - copy the **signature key** →
     `update app_config set value='<sig key>' where key='square_webhook_signature_key';`
   - if the URL differs from the default, also set `square_webhook_url` to the
     exact registered URL (the signature is computed over URL + body).
4. Test with a real $1-ish order, then refund it in Square.

Switching to Stripe later is one row: `payment_provider = 'stripe'` (its keys
and webhook are already wired).

## Closed-day test order (go-live runbook)

When the restaurant is closed, real orders are refused with 409. For the
go-live test on a closed day, set `app_config.test_order_token`, then place a
normal order typing the secret at the **start of the notes box** — the order
then rides the **full live path** (real Square charge, real webhook, real
kitchen ticket; refund it afterwards) and is loudly marked: order code
`TEST-…` and notes prefixed `[SYSTEM TEST ORDER]`. Public traffic without the
secret stays refused exactly as before, and in demo mode it does nothing.

1. `insert into app_config (key,value) values ('test_order_token','<long random string>')
   on conflict (key) do update set value=excluded.value;`
2. Order normally; in the notes box type, first thing:
   `#test:<the same value>` — anything after a space is kept as the real note.
   The secret travels only in the POST body (never a URL — B-4) and is
   stripped server-side before the notes are stored, match or no match.
3. **Delete the row right after the test:**
   `delete from app_config where key='test_order_token';`
4. **Verify the revocation with your own eyes (B-6):** repeat the same
   out-of-hours order attempt, `#test:` and all, and watch it get the
   ordinary "We're closed right now" refusal before walking away.

The secret lives only in `app_config` (this repo is publicly served — nothing
secret can live in code), is compared timing-safe server-side, and unlocks
nothing except the opening-hours refusal. A wrong value gets the identical
refusal everyone else gets (B-5). Per client, always generate a fresh value;
never reuse one.

> Zachary pastes these values himself — never share live payment credentials
> in chat, and never send them to anyone who asks for them by message.

## Website prices are +3% over the in-house menu
Kareem's instruction (2026-07-25). `data.js` holds the printed in-house prices;
`LILYS.onlineCents()` applies the markup (rounded to 5¢) for the menu page, the
order page and `scripts/sync-menu.mjs`. **After any menu edit, re-run the sync**
or the server will charge stale prices:
`node scripts/sync-menu.mjs > /tmp/menu-sync.sql` then apply it.

## Turning on order emails (Resend — ~2 minutes)
1. Create a free account at resend.com (100 emails/day free) and copy an API key.
2. `update app_config set value='re_…' where key='resend_api_key';`
   `update app_config set value='lilysmediterraneangrill@gmail.com' where key='notify_email';`
3. Until a sending domain is verified in Resend, mail comes from
   `onboarding@resend.dev` and Resend only delivers to the account owner's own
   email — so use Zachary's email first, then verify the production domain and
   set `notify_from` (e.g. `Lily's Orders <orders@lilysmediterranean.com>`) and
   switch `notify_email` to Kareem's.

## Monitoring
A scheduled task `lilys-health-check` (Claude scheduled tasks, daily 15:30 UK)
curls the order page, order-status, menu_items, and kitchen-api auth path, and
pushes an alert if anything fails. For minute-level monitoring add UptimeRobot
(free) on https://zachachacker.github.io/lilys-mediterranean/order.html.

## Going live with Kareem's Stripe account
1. In Kareem's Stripe dashboard: get the **secret key** (`sk_live_…`).
2. Add a webhook endpoint: `https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/stripe-webhook`
   with events `checkout.session.completed` and `checkout.session.expired`; copy its
   **signing secret** (`whsec_…`).
3. Store both (SQL editor or MCP):
   `update app_config set value='sk_live_…' where key='stripe_secret_key';` (insert if missing)
   `insert into app_config (key,value) values ('stripe_secret_key','sk_live_…'),('stripe_webhook_secret','whsec_…') on conflict (key) do update set value=excluded.value;`
4. Update `app_config.site_url` when the production domain goes live.
5. Test with Stripe **test keys** first (`sk_test_…`) — card 4242 4242 4242 4242.

## Menu changes
Edit `data.js`, then run `node scripts/sync-menu.mjs` and apply the SQL it prints —
the server prices orders from `menu_items`, so the two must stay in sync.

**Deploy `data.js` at the same time.** The order page builds its cart from
`data.js` but the server charges from `menu_items`. Update one without the other
and customers see prices the server won't honour, or dishes it will reject.

Two rules that came out of the 2026-07-25 sync:

- **Never tag an item `GF` if it is served with pita.** Kareem confirmed the
  pita is not gluten free (gluten-free pita is a +$1.99 add-on). Platters and
  family specials come with pita, so they carry no GF tag; the family specials
  spell the exception out in their description instead. A stale gluten-free
  badge is the one error here that can put someone in hospital.
- **No price ranges.** `parsePrice` can't read `"$12.99–$19.99"`, so the item
  lands at 1 cent and `orderable=false` — invisible to customers and unsellable.
  Split it into separate items (see Chicken Wings 6 pc / 12 pc).

## Kitchen tablet
Open `kitchen.html`, enter the kitchen key once (stored in `app_config.kitchen_key`).
Sales tax rate lives in `app_config.tax_rate` (0.07 — confirm with Kareem) and is
mirrored in `data.js` ORDERING.taxRate for display.
