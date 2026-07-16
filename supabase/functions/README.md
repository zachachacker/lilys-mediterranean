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
  `x-kitchen-key` header matching `app_config.kitchen_key`.

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

## Kitchen tablet
Open `kitchen.html`, enter the kitchen key once (stored in `app_config.kitchen_key`).
Sales tax rate lives in `app_config.tax_rate` (0.07 — confirm with Kareem) and is
mirrored in `data.js` ORDERING.taxRate for display.
