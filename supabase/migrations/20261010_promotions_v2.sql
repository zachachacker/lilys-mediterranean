-- Offers Kareem manages himself (2026-10-10). APPLIED via MCP as "promotions_v2".
alter table public.promotions drop constraint if exists promotions_kind_check;
alter table public.promotions add constraint promotions_kind_check check (kind in ('bogo','percent_over','percent_items'));
alter table public.promotions add column if not exists item_ids text[];
alter table public.promotions add column if not exists categories text[];
alter table public.promotions add column if not exists days int[];          -- 0=Sun..6=Sat, null = every day
alter table public.promotions add column if not exists start_min int check (start_min between 0 and 1440); -- Florida clock
alter table public.promotions add column if not exists end_min int check (end_min between 0 and 1440);
alter table public.promotions add constraint percent_items_complete check (kind <> 'percent_items' or (percent is not null and (coalesce(cardinality(item_ids),0) > 0 or coalesce(cardinality(categories),0) > 0)));
alter table public.promotions add constraint window_complete check ((start_min is null) = (end_min is null) and (start_min is null or start_min < end_min));
-- manage.html's key (random; read it with SQL, never commit it)
insert into public.app_config(key, value) values ('manager_key', encode(extensions.gen_random_bytes(20), 'hex')) on conflict (key) do nothing;
