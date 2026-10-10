-- Add-ons (Kareem, 2026-10-10): sides, sauces, extra skewers, protein, spice.
-- Like menu_items, these tables are generated from data.js by
-- scripts/sync-menu.mjs, and create-checkout prices every add-on from them,
-- never from the browser. Public read (the order page shows what's sold out);
-- no write policy, so only the service role (Edge Functions) can change them.

create table if not exists public.addon_groups (
  id text primary key,
  label text not null,
  max_select int not null default 1 check (max_select between 1 and 20),
  sort int not null default 0
);

create table if not exists public.addon_options (
  id text primary key,
  group_id text not null references public.addon_groups(id) on delete cascade,
  name text not null,
  price_cents int not null check (price_cents between 0 and 100000),
  sort int not null default 0
  -- stock columns (out_until, hidden): see 20261010_stock_states.sql
);

alter table public.menu_items add column if not exists addon_groups text[] not null default '{}';

alter table public.addon_groups enable row level security;
alter table public.addon_options enable row level security;
drop policy if exists addon_groups_public_read on public.addon_groups;
create policy addon_groups_public_read on public.addon_groups for select using (true);
drop policy if exists addon_options_public_read on public.addon_options;
create policy addon_options_public_read on public.addon_options for select using (true);
