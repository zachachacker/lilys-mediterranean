-- Lily's Club perks (2026-10-24, Zachary picked all four):
--   welcome bonus   club_welcome_points: added once as a club_points row when
--                   the member is created (existing members backfilled below)
--   double points   club_double_days (Florida weekdays, 0=Sun) for orders
--                   placed on/after club_double_since; derived in clubPoints
--   birthday treat  club_birthday_cents, $ off once a year; month set once and
--                   locked, 60+ days on the account, 3 paid orders, and once
--                   per phone fingerprint too (clubBirthday + phone check)
--   members-only    promotions.members_only: create-checkout applies it only
--                   to a signed-in member; Kareem ticks it in the deals manager
alter table public.club_members add column if not exists birth_month smallint check (birth_month between 1 and 12);
alter table public.club_members add column if not exists birth_month_set_at timestamptz;
alter table public.promotions add column if not exists members_only boolean not null default false;
insert into public.app_config(key, value) values
  ('club_welcome_points', '20'),
  ('club_double_days', '1,2'),
  ('club_double_since', '2026-10-25T00:00:00-04:00'),
  ('club_birthday_cents', '500')
on conflict (key) do nothing;
insert into public.club_points(email, delta, reason, by_who)
  select m.email, 20, 'welcome bonus', 'club' from public.club_members m
  where not exists (select 1 from public.club_points p where p.email = m.email and p.reason = 'welcome bonus');
