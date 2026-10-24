-- Why a never-paid checkout didn't pay (declined card vs walked away).
-- Filled by the reconcile sweep from Stripe; read by the owner dashboard.
alter table orders add column if not exists unpaid_reason text;
