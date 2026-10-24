-- Lily's Club accounts + points (2026-10-24, Kareem: "spend 50 get 5 or 10";
-- Zachary picked the ladder). An account is an email, proven by a 6-digit
-- code; there are no passwords. Points are DERIVED, never stored as a running
-- total, so nothing can drift:
--   earned  = $1 of food (subtotal - discounts) = 1 point, on every paid order
--             whose customer_email OR club_email is the member's email
--             (past orders count too)
--   spent   = discounts entries {id:"club-points", email, points} on orders
--             that are paid, or still pending (a hold while they pay)
--   adjust  = club_points rows (in-store scans, corrections)
-- The club edge function and create-checkout compute it the same way
-- (clubBalance, byte-identical, mirrors test). RLS on, no policies: only the
-- functions (service role) read or write these tables.
create table if not exists public.club_members (
  email text primary key,
  name text,
  member_code text unique not null,      -- printed in the wallet card's QR (in-store scan)
  created_at timestamptz not null default now()
);
create table if not exists public.club_codes (
  email text primary key,
  code_hash text not null,               -- sha256(email + ":" + code)
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_count int not null default 1,     -- codes sent in the current hour
  window_start timestamptz not null default now()
);
create table if not exists public.club_sessions (
  token_hash text primary key,           -- sha256 of the token the browser keeps
  email text not null references public.club_members(email) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table if not exists public.club_points (
  id bigserial primary key,
  email text not null references public.club_members(email) on delete cascade,
  delta int not null,
  reason text not null,
  by_who text,
  created_at timestamptz not null default now()
);
alter table public.club_members enable row level security;
alter table public.club_codes enable row level security;
alter table public.club_sessions enable row level security;
alter table public.club_points enable row level security;

-- the signed-in member an order belongs to, whatever email they give Stripe
alter table public.orders add column if not exists club_email text;
create index if not exists orders_customer_email_idx on public.orders (customer_email) where customer_email is not null;
create index if not exists orders_club_email_idx on public.orders (club_email) where club_email is not null;

-- "points:cents" rungs, cheapest first. Off = anything but 'true'.
insert into public.app_config(key, value) values
  ('club_points_enabled', 'true'), ('club_reward_tiers', '50:500,100:1200')
on conflict (key) do nothing;

-- "email me offers" ticked while signing in to an account
alter table public.subscribers drop constraint if exists subscribers_source_check;
alter table public.subscribers add constraint subscribers_source_check
  check (source = any (array['checkout', 'signup', 'signup-receipt', 'club-account']));

-- points replace the 5-orders reward (past orders already earn points, so
-- nobody's progress is lost once they sign in)
update public.app_config set value = 'false' where key = 'loyalty_enabled';
