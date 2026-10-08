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

// which current statuses may move to a given target — forward taps AND
// one-step undo/recall (a mistap on a touchscreen must be recoverable)
const ALLOWED_FROM: Record<string, string[]> = {
  paid: ["making"],                   // undo "start making"
  making: ["paid", "ready", "done"],  // advance, undo "ready", or recall a bumped ticket
  ready: ["making", "done"],          // advance, or undo "picked up"
  done: ["ready"],
  canceled: ["paid", "making", "ready"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: keyRows, error: keyErr } = await db
    .from("app_config")
    .select("key,value")
    .in("key", ["kitchen_key", "kitchen_key_prev", "kitchen_key_prev_until"]);
  if (keyErr) {
    // transient DB blip must read as "try again", not "wrong key" — a 401 logs the tablet out
    console.error("kitchen_key read failed:", keyErr.message);
    return json({ error: "Temporarily unavailable" }, 503);
  }
  const kc = Object.fromEntries((keyRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const expected = kc.kitchen_key ?? "";
  const provided = req.headers.get("x-kitchen-key") ?? "";
  // Key rotation without a dark board: the previous key keeps working until
  // kitchen_key_prev_until, so a tablet still on it isn't logged out before it
  // has been moved to the new setup link. After that moment it is dead.
  const prev = kc.kitchen_key_prev ?? "";
  const prevUntil = Date.parse(kc.kitchen_key_prev_until ?? "");
  const currentOk = expected.length > 0 && timingSafeEqual(provided, expected);
  const prevOk = !currentOk && prev.length > 0 && Number.isFinite(prevUntil) && Date.now() < prevUntil &&
    timingSafeEqual(provided, prev);
  if (!currentOk && !prevOk) {
    // every miss is logged and costs the caller a second, so guessing is slow and visible
    console.warn("kitchen-api: wrong key attempt");
    await new Promise((r) => setTimeout(r, 1000));
    return json({ error: "Wrong kitchen key" }, 401);
  }
  if (prevOk) console.log("kitchen-api: request on the previous key (rotation grace period)");

  let body: { action?: string; id?: string; to?: string; available?: boolean; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  /* ---- stock control ---------------------------------------------------
     86'ing an item. The switch is menu_items.orderable, which create-checkout
     already enforces server-side — this only exposes it to the tablet. */
  if (body.action === "stock") {
    const { data, error } = await db
      .from("menu_items")
      .select("id,name,category,orderable")
      .order("category")
      .order("name");
    if (error) {
      console.error("stock list failed:", error.message);
      return json({ error: "Temporarily unavailable" }, 503);
    }
    return json({ items: data ?? [] });
  }

  if (body.action === "set_stock") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id || typeof body.available !== "boolean") {
      return json({ error: "Bad request" }, 400);
    }
    // .select() so a bad id is a 404 rather than a silent no-op — the tablet
    // must never show a toggle as flipped when nothing changed
    const { data, error } = await db
      .from("menu_items")
      .update({ orderable: body.available })
      .eq("id", id)
      .select("id,orderable");
    if (error) {
      console.error("set_stock failed:", error.message);
      return json({ error: "Temporarily unavailable" }, 503);
    }
    if (!(data ?? []).length) return json({ error: "Unknown item" }, 404);
    return json({ ok: true, id, available: data[0].orderable });
  }

  /* ---- offers ----------------------------------------------------------
     Switching a promotion on or off, and nothing else. Creating or editing one
     deliberately stays off the tablet: a mistyped percentage here comes out of
     the till on every order that follows, and it would be typed one-handed by
     someone holding a pan. The shapes are authored once, then switched. */
  if (body.action === "promos") {
    const { data, error } = await db
      .from("promotions")
      .select("id,kind,label,active,item_id,buy_qty,free_qty,percent,min_subtotal_cents,starts_at,ends_at")
      .order("kind")
      .order("label");
    if (error) {
      console.error("promos list failed:", error.message);
      return json({ error: "Temporarily unavailable" }, 503);
    }
    return json({ promos: data ?? [], now: new Date().toISOString() });
  }

  if (body.action === "set_promo") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id || typeof body.active !== "boolean") return json({ error: "Bad request" }, 400);
    // .select() for the same reason set_stock does it — an unknown id must be a
    // 404, never a toggle that shows as flipped while nothing changed
    const { data, error } = await db
      .from("promotions")
      .update({ active: body.active })
      .eq("id", id)
      .select("id,active");
    if (error) {
      console.error("set_promo failed:", error.message);
      return json({ error: "Temporarily unavailable" }, 503);
    }
    if (!(data ?? []).length) return json({ error: "Unknown offer" }, 404);
    return json({ ok: true, id, active: data[0].active });
  }

  if (body.action === "list") {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data, error } = await db
      .from("orders")
      .select("id,code,status,customer_name,customer_phone,notes,items,subtotal_cents,tax_cents,total_cents,created_at,updated_at,demo,stripe_payment_intent,fulfilment,delivery_address,delivery_miles,delivery_fee_cents,tip_cents")
      // finished TEST- orders (go-live checks) never clutter "Earlier today" or the
      // day's totals; a live TEST order still shows, so a test can still ring
      .or(`status.in.(paid,making,ready),and(status.in.(done,canceled),created_at.gte.${twelveHoursAgo},code.not.like.TEST-*)`)
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
