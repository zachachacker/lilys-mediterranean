-- "Your order is ready" emails (2026-10-10). APPLIED via MCP as "notify_ready".
-- stripe-webhook stores Stripe's customer_details.email as orders.customer_email
-- on payment; when the kitchen taps Ready, orders_notify_ready calls notify-ready
-- (pg_net, same pattern as notify_order_paid). ready_notified_at is claimed
-- before sending, so undo -> Ready never emails twice.
-- Kill switch: app_config ready_email_enabled = 'false'.
alter table public.orders add column if not exists customer_email text check (customer_email is null or length(customer_email) <= 254);
alter table public.orders add column if not exists ready_notified_at timestamptz;
-- function public.notify_order_ready(): net.http_post(.../functions/v1/notify-ready, {order_id})
create trigger orders_notify_ready after update on public.orders
for each row when (old.status is distinct from 'ready' and new.status = 'ready' and new.customer_email is not null and new.ready_notified_at is null)
execute function public.notify_order_ready();
