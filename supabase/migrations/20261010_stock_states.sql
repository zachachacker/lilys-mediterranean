-- Stock control matching Kareem's Sauce menu editor (2026-10-10): every dish
-- and add-on is Available, Out of stock today (back by itself the next
-- morning), Out of stock (until switched back) or Hidden (off the menu).
--   out_until null            available
--   out_until > now()         out of stock until then (today = next 4am Florida)
--   out_until = 2999-01-01    out of stock until switched back
--   hidden = true             not shown at all
-- menu_items.orderable now only means "has a fixed price" (set by sync-menu),
-- so re-syncing the menu can never undo the kitchen's stock switches.
alter table public.menu_items add column if not exists out_until timestamptz;
alter table public.menu_items add column if not exists hidden boolean not null default false;
alter table public.addon_options add column if not exists out_until timestamptz;
alter table public.addon_options add column if not exists hidden boolean not null default false;
alter table public.addon_options drop column if exists available;
