-- Lily's Club welcome gift (2026-10-20): 10% off the next order, never more
-- than $7.50 (was 5%). create-checkout applies the cap to 'club' tokens;
-- data.js clubPercent / clubMaxOff and kitchen.js CLUB_PERCENT say the same.
-- Welcome tokens already sent keep their 5%.
insert into public.app_config(key, value) values ('club_max_cents', '750')
on conflict (key) do update set value = excluded.value;
insert into public.app_config(key, value) values ('club_welcome_percent', '10')
on conflict (key) do update set value = excluded.value;
