-- Job applications from careers.html (2026-10-16, Kareem is hiring line cooks,
-- prep cooks and cashiers/servers). The "apply" Edge Function is the only
-- writer and reader (service role): RLS is on with NO policies, so the anon
-- key can't read or write this table at all.
-- Rate limit: the function refuses a 4th application from the same ip_hash
-- (a salted SHA-256 of the visitor's IP, never the IP itself) within 24 hours.
create table if not exists public.job_applications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text,
  positions text[] not null,
  availability text[] not null,
  start_date date,
  experience text,
  notes text,
  over_16 boolean not null,
  ip_hash text
);

alter table public.job_applications enable row level security;
revoke all on table public.job_applications from anon, authenticated;

create index if not exists job_applications_ip_recent on public.job_applications (ip_hash, created_at desc);
