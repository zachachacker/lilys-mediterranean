-- Promotions (Kareem, 2026-08-05): buy-one-get-one, and a percentage off once
-- the basket reaches a threshold. Deliberately two fixed shapes rather than a
-- configurable rules engine — this is the money path and a smaller surface is
-- a smaller thing to get wrong.
--
-- NOT YET APPLIED. The Supabase project was INACTIVE when this was written and
-- its hostname did not resolve. Apply after restoring, then re-run the tests.

create table if not exists public.promotions (
  id                 text primary key,
  kind               text not null check (kind in ('bogo', 'percent_over')),
  label              text not null,          -- exactly what the customer is shown
  active             boolean not null default false,

  -- bogo
  item_id            text references public.menu_items (id) on delete cascade,
  buy_qty            integer check (buy_qty > 0),
  free_qty           integer check (free_qty > 0),

  -- percent_over
  percent            integer check (percent > 0 and percent <= 100),
  min_subtotal_cents integer check (min_subtotal_cents >= 0),

  starts_at          timestamptz,
  ends_at            timestamptz,
  created_at         timestamptz not null default now(),

  -- a row must be fully specified for its own kind; a half-filled promotion is
  -- the same class of bug as a half-filled Square config
  constraint bogo_complete check (
    kind <> 'bogo' or (item_id is not null and buy_qty is not null
                       and free_qty is not null and free_qty <= buy_qty)),
  constraint percent_complete check (
    kind <> 'percent_over' or (percent is not null and min_subtotal_cents is not null))
);

-- the customer-facing page lists active offers; nothing else is public
alter table public.promotions enable row level security;
create policy promotions_public_read on public.promotions
  for select to anon, authenticated using (active = true);

revoke insert, update, delete, truncate on public.promotions from anon, authenticated;

-- what was actually taken off, recorded on the order itself so a receipt can
-- always be reconstructed even if the promotion is later edited or deleted
alter table public.orders add column if not exists discount_cents integer not null default 0;
alter table public.orders add column if not exists discounts jsonb;
