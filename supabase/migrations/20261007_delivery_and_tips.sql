-- Delivery + driver tips (Kareem, 2026-10-07). APPLIED 2026-10-07 via MCP.
-- Every existing order becomes 'pickup' by default; a delivery row must carry
-- its address and distance, the same "fully specified or rejected" rule the
-- promotions table uses.
alter table public.orders
  add column if not exists fulfilment text not null default 'pickup' check (fulfilment in ('pickup','delivery')),
  add column if not exists delivery_address text,
  add column if not exists delivery_miles numeric(5,2),
  add column if not exists delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  add column if not exists tip_cents integer not null default 0 check (tip_cents >= 0);

alter table public.orders add constraint delivery_complete
  check (fulfilment <> 'delivery' or (delivery_address is not null and delivery_miles is not null));
