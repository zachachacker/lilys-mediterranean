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

// Refer a friend (held off until Kareem sets the terms): a paid customer gets
// one share link of their own, created the first time they see a paid order.
// The token is only ever shown to whoever holds this order's session id.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const newToken = () => [...crypto.getRandomValues(new Uint8Array(10))].map((b) => ALPHABET[b % 30]).join("");

async function referralFor(
  // deno-lint-ignore no-explicit-any
  db: any,
  o: { status: string; demo: boolean; customer_hash: string | null; code: string },
): Promise<{ token: string; percent: number } | null> {
  if (o.demo || !o.customer_hash || o.code.startsWith("TEST-") || !["paid", "making", "ready", "done"].includes(o.status)) return null;
  const { data: cfg } = await db.from("app_config").select("key,value").in("key", ["referral_enabled", "referral_percent"]);
  const c = Object.fromEntries((cfg ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if ((c.referral_enabled ?? "").trim() !== "true") return null;
  const percent = Number(c.referral_percent ?? "10");
  const { data: have } = await db.from("promo_tokens").select("token")
    .eq("kind", "referral").eq("referrer_hash", o.customer_hash).maybeSingle();
  if (have) return { token: have.token, percent };
  const token = newToken();
  const { error } = await db.from("promo_tokens").insert({ token, kind: "referral", percent, referrer_hash: o.customer_hash });
  if (error) {
    // a parallel poll created it first (one per customer, by unique index)
    const { data: again } = await db.from("promo_tokens").select("token")
      .eq("kind", "referral").eq("referrer_hash", o.customer_hash).maybeSingle();
    return again ? { token: again.token, percent } : null;
  }
  return { token, percent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sid = new URL(req.url).searchParams.get("sid") ?? "";
  if (!sid || sid.length > 200) return json({ error: "Missing sid" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db
    .from("orders")
    .select("id,code,status,items,subtotal_cents,discount_cents,tax_cents,total_cents,created_at,demo,customer_name,fulfilment,delivery_address,delivery_fee_cents,tip_cents,customer_hash")
    .eq("stripe_session_id", sid)
    .maybeSingle();
  if (error) return json({ error: "Lookup failed" }, 500);
  if (!data) return json({ error: "Order not found" }, 404);
  // whether this order has been rated, so the page doesn't ask twice; the
  // internal id is used for the lookup and never returned
  const { id, customer_hash, ...order } = data;
  const { data: fb } = await db.from("feedback").select("rating").eq("order_id", id).maybeSingle();
  return json({ order: { ...order, rated: fb?.rating ?? null, referral: await referralFor(db, data) } });
});
