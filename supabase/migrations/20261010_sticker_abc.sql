-- Sticker A/B/C test (2026-10-10). APPLIED via MCP as "sticker_abc_test".
-- promo_tokens.batch = design: ubereats-1-a (brand coupon), -b (food photo),
-- -c (same food, less money); 24 each. The original 48 were split into a and b.
-- scan_count / first_scanned_at, bumped by note_scan() from create-checkout's
-- code check; owner-stats returns per-design totals (never the tokens).
alter table public.promo_tokens add column if not exists scan_count int not null default 0;
alter table public.promo_tokens add column if not exists first_scanned_at timestamptz;
-- function public.note_scan(p_token text): security definer, service role only
