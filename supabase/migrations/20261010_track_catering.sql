-- Catering page visits get their own counter (they were landing in visit_home).
CREATE OR REPLACE FUNCTION public.track_event(p_event text, p_item text DEFAULT ''::text, p_source text DEFAULT ''::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if p_event not in ('visit_home','visit_menu','visit_order','visit_catering','add_to_cart','checkout_start') then return; end if;
  insert into public.site_events (day, event, item, source, count)
  values ((now() at time zone 'America/New_York')::date, p_event,
          left(coalesce(regexp_replace(p_item, '[^a-z0-9-]', '', 'g'), ''), 60),
          left(coalesce(regexp_replace(p_source, '[^a-z0-9_-]', '', 'g'), ''), 40), 1)
  on conflict (day, event, item, source) do update set count = public.site_events.count + 1;
end $function$;
