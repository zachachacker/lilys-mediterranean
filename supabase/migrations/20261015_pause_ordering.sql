-- Pause online ordering from the kitchen screen (2026-10-15, Kareem asked).
-- kitchen-api "pause" writes app_config orders_paused_until ('' = open);
-- create-checkout refuses while it is in the future. The order page reads it
-- through this function only (app_config itself stays private).
insert into public.app_config (key, value) values ('orders_paused_until', '')
on conflict (key) do nothing;

create or replace function public.ordering_paused_until()
returns timestamptz language sql stable security definer set search_path = public as $$
  select case when value ~ '^\d{4}-' and value::timestamptz > now() then value::timestamptz end
  from public.app_config where key = 'orders_paused_until'
$$;
revoke all on function public.ordering_paused_until() from public;
grant execute on function public.ordering_paused_until() to anon, authenticated;
