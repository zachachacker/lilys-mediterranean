// Owner analytics for Zachary's dashboard (2026-10-08).
// Access: x-owner-key header must match app_config.owner_key — a separate secret
// from the kitchen key, so nobody holding the kitchen iPad can read the money.
// Returns order FIGURES only: no customer names, phone numbers, notes or
// addresses ever leave this function. TEST- and demo orders are excluded so
// every number on the dashboard is a real customer.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-owner-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// byte-identical to kitchen-api/index.ts timingSafeEqual
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i];
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: keyRow, error: keyErr } = await db.from("app_config").select("value").eq("key", "owner_key").maybeSingle();
  if (keyErr) return json({ error: "Temporarily unavailable" }, 503);
  const expected = keyRow?.value ?? "";
  const provided = req.headers.get("x-owner-key") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    console.warn("owner-stats: wrong key attempt");
    await new Promise((r) => setTimeout(r, 1000));
    return json({ error: "Wrong owner key" }, 401);
  }

  // last 400 days is far more than the dashboard's widest preset needs
  const since = new Date(Date.now() - 400 * 86400 * 1000).toISOString();
  const { data, error } = await db
    .from("orders")
    .select("code,status,fulfilment,created_at,updated_at,items,subtotal_cents,discount_cents,tax_cents,delivery_fee_cents,tip_cents,total_cents,stripe_payment_intent")
    .eq("demo", false)
    .not("code", "like", "TEST-%")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("owner-stats read failed:", error.message);
    return json({ error: "Temporarily unavailable" }, 503);
  }
  // items carry only dish id, name, qty and price — strip anything else defensively
  // `charged` tells an unpaid checkout that expired apart from an order the
  // kitchen cancelled; the payment id itself never leaves this function
  const orders = (data ?? []).map(({ stripe_payment_intent, ...o }: Record<string, unknown>) => ({
    ...o,
    charged: Boolean(stripe_payment_intent),
    items: ((o.items as { id: string; name: string; qty: number; unit_cents: number }[]) ?? [])
      .map(({ id, name, qty, unit_cents }) => ({ id, name, qty, unit_cents })),
  }));
  return json({ orders, now: new Date().toISOString() });
});
