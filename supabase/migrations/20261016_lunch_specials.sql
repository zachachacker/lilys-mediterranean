-- Lunch specials (2026-10-16). Required pick-one add-on groups (fries or rice,
-- which sauce): min_select > 0 means the customer must choose. create-checkout
-- (priceAddons) enforces it. The dishes and lunch add-ons themselves come from
-- data.js via scripts/sync-menu.mjs.
alter table public.addon_groups add column if not exists min_select integer not null default 0;
