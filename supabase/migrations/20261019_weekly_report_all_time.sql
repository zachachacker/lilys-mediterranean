-- Weekly report (2026-10-19): the first one covers everything since the first
-- website order, then it reverts to Monday-to-Sunday weeks. The function sets
-- this back to 'false' after that first send succeeds.
insert into public.app_config(key, value) values ('weekly_report_all_time', 'true')
on conflict (key) do update set value = excluded.value;
