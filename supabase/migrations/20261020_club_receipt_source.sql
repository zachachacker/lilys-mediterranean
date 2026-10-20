-- Lily's Club (2026-10-20): the printed receipt carries a Club QR
-- (club.html?src=receipt). deals stores those joins as 'signup-receipt' so the
-- dashboard can tell whether the receipt brings members.
alter table public.subscribers drop constraint if exists subscribers_source_check;
alter table public.subscribers add constraint subscribers_source_check
  check (source = any (array['checkout', 'signup', 'signup-receipt']));
