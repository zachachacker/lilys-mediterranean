// Order lookup for the confirmation page — keyed by the unguessable
// Stripe/demo session id the customer was redirected with.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sid = new URL(req.url).searchParams.get("sid") ?? "";
  if (!sid || sid.length > 200) return json({ error: "Missing sid" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db
    .from("orders")
    .select("id,code,status,items,subtotal_cents,discount_cents,tax_cents,total_cents,created_at,demo,customer_name,fulfilment,delivery_address,delivery_fee_cents,tip_cents")
    .eq("stripe_session_id", sid)
    .maybeSingle();
  if (error) return json({ error: "Lookup failed" }, 500);
  if (!data) return json({ error: "Order not found" }, 404);
  // whether this order has been rated, so the page doesn't ask twice; the
  // internal id is used for the lookup and never returned
  const { id, ...order } = data;
  const { data: fb } = await db.from("feedback").select("rating").eq("order_id", id).maybeSingle();
  return json({ order: { ...order, rated: fb?.rating ?? null } });
});
