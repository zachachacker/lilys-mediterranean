-- Catering enquiries from catering.html (2026-10-19). The "catering-enquiry"
-- Edge Function is the only writer and reader (service role): RLS is on with
-- NO policies, so the anon key can't read or write this table at all.
-- Rate limit: the function refuses a 4th enquiry from the same ip_hash (a
-- salted SHA-256 of the visitor's IP, never the IP itself) within 24 hours.
create table if not exists public.catering_enquiries (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text,
  company text,
  event_date date not null,
  guests integer not null check (guests between 5 and 2000),
  fulfilment text not null check (fulfilment in ('Pickup', 'Delivery', 'Not sure yet')),
  notes text,
  source text,
  ip_hash text
);

alter table public.catering_enquiries enable row level security;
revoke all on table public.catering_enquiries from anon, authenticated;

create index if not exists catering_enquiries_ip_recent on public.catering_enquiries (ip_hash, created_at desc);
