-- Feature launch dates for the weekly report (2026-10-19): tips and delivery
-- went live partway through the first fortnight, so the first (all-time)
-- report counts each over its own days. Pickup tips: 0155784 (10 Oct);
-- delivery on: 09ca2eb (16 Oct). weekly_report_all_time_note is the line at
-- the top of that first report.
insert into public.app_config(key, value) values
  ('tips_live_since', '2026-10-10'),
  ('delivery_live_since', '2026-10-16'),
  ('weekly_report_all_time_note', 'All of this with zero marketing: your Google Ads were off the whole time, and not one order came from ads, flyers or discounts. This is what your website does on its own.')
on conflict (key) do update set value = excluded.value;
