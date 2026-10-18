-- Weekly owner report (2026-10-19): supabase/functions/weekly-report.
-- Off until weekly_report_enabled = 'true'. Recipient is notify_email unless
-- weekly_report_to is set; weekly_report_cc adds copies (comma-separated).
-- Addresses are set in the database, never here: this repo is public.
-- weekly_report_last_week is the Monday of the last week sent (the send guard).
insert into public.app_config(key, value) values
  ('weekly_report_enabled', 'false'),
  ('weekly_report_last_week', '1970-01-01'),
  ('weekly_report_cc', ''),
  ('weekly_report_baseline', ''),
  ('ads_spend_week', '')
on conflict (key) do nothing;

-- Mondays 12:45 UTC = 08:45 Florida in summer time, 07:45 in winter
select cron.schedule('weekly-report', '45 12 * * 1', $$
  select net.http_post(
    url := 'https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/weekly-report',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5dHZmcXlkYWh3c3JjZGJudmZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDk3NDYsImV4cCI6MjA5OTc4NTc0Nn0.taAfp5xGFYdxyNxeszmxEt5Me-PPNfUbXfs4suLvXt0"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
