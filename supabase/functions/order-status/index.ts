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
    .select("code,status,items,subtotal_cents,tax_cents,total_cents,created_at,demo,customer_name")
    .eq("stripe_session_id", sid)
    .maybeSingle();
  if (error) return json({ error: "Lookup failed" }, 500);
  if (!data) return json({ error: "Order not found" }, 404);
  return json({ order: data });
});
