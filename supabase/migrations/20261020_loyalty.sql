-- Loyalty (2026-10-20): every 5 paid online orders earn $10 off a later one,
-- automatically, by the salted phone fingerprint (no account, no card).
-- create-checkout applies it (orders.discounts id 'loyalty' marks a spent
-- reward); order-status and kitchen-api show progress. Off = loyalty_enabled
-- anything but 'true'.
insert into public.app_config(key, value) values
  ('loyalty_enabled', 'true'), ('loyalty_every', '5'), ('loyalty_cents', '1000')
on conflict (key) do update set value = excluded.value;
create index if not exists orders_customer_hash_idx on public.orders (customer_hash) where customer_hash is not null;
