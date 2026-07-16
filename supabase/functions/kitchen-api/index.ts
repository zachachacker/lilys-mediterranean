// Kitchen tablet API — list active orders and advance their status.
// Access: x-kitchen-key header must match app_config.kitchen_key
// (a long random secret typed once into the tablet).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kitchen-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i];
  return out === 0;
}

// which current statuses may move to a given target
const ALLOWED_FROM: Record<string, string[]> = {
  making: ["paid"],
  ready: ["making"],
  done: ["ready"],
  canceled: ["paid", "making", "ready"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: keyRow, error: keyErr } = await db.from("app_config").select("value").eq("key", "kitchen_key").maybeSingle();
  if (keyErr) {
    // transient DB blip must read as "try again", not "wrong key" — a 401 logs the tablet out
    console.error("kitchen_key read failed:", keyErr.message);
    return json({ error: "Temporarily unavailable" }, 503);
  }
  const expected = keyRow?.value ?? "";
  const provided = req.headers.get("x-kitchen-key") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    return json({ error: "Wrong kitchen key" }, 401);
  }

  let body: { action?: string; id?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.action === "list") {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data, error } = await db
      .from("orders")
      .select("id,code,status,customer_name,customer_phone,notes,items,subtotal_cents,tax_cents,total_cents,created_at,updated_at,demo")
      .or(`status.in.(paid,making,ready),and(status.in.(done,canceled),created_at.gte.${twelveHoursAgo})`)
      .order("created_at", { ascending: true });
    if (error) return json({ error: "List failed" }, 500);
    return json({ orders: data, now: new Date().toISOString() });
  }

  if (body.action === "advance") {
    const to = String(body.to ?? "");
    const id = String(body.id ?? "");
    const from = ALLOWED_FROM[to];
    if (!from || !id) return json({ error: "Bad transition" }, 400);
    const { data, error } = await db
      .from("orders")
      .update({ status: to })
      .eq("id", id)
      .in("status", from)
      .select("id,code,status")
      .maybeSingle();
    if (error) return json({ error: "Update failed" }, 500);
    if (!data) return json({ error: "Order changed underneath you — refreshing." }, 409);
    return json({ order: data });
  }

  return json({ error: "Unknown action" }, 400);
});
