-- Google review requests (2026-10-10). About two hours after an online order is
-- collected, the customer gets one short email asking for a Google review.
-- The ask-review function picks the due orders itself; pg_cron just pokes it.
--  * once per order (review_asked_at), and at most once per email address
--    every 120 days, so regulars aren't nagged
--  * everyone gets the same ask (no "only if you were happy" gate: Google bans
--    review gating)
--  * kill switch: app_config review_email_enabled = 'false'
alter table public.orders add column if not exists review_asked_at timestamptz;

insert into public.app_config (key, value) values ('review_email_enabled', 'true')
on conflict (key) do nothing;

-- review.html counts taps on the review button before sending people to Google
CREATE OR REPLACE FUNCTION public.track_event(p_event text, p_item text DEFAULT ''::text, p_source text DEFAULT ''::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if p_event not in ('visit_home','visit_menu','visit_order','visit_catering','add_to_cart','checkout_start','review_click') then return; end if;
  insert into public.site_events (day, event, item, source, count)
  values ((now() at time zone 'America/New_York')::date, p_event,
          left(coalesce(regexp_replace(p_item, '[^a-z0-9-]', '', 'g'), ''), 60),
          left(coalesce(regexp_replace(p_source, '[^a-z0-9_-]', '', 'g'), ''), 40), 1)
  on conflict (day, event, item, source) do update set count = public.site_events.count + 1;
end $function$;

-- every 15 minutes; same auth header as the reconcile job (anon key)
-- select cron.schedule('ask-review', '*/15 * * * *', $$ select net.http_post(
--   url := 'https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/ask-review',
--   headers := '{"Content-Type": "application/json", "Authorization": "Bearer <anon key>"}'::jsonb,
--   body := '{}'::jsonb) $$);
