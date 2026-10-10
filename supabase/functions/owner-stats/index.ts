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

// deno-lint-ignore no-explicit-any
async function stickerStats(db: any) {
  const { data: toks, error } = await db.from("promo_tokens")
    .select("token,batch,scan_count,order_id").eq("kind", "sticker");
  if (error) { console.error("sticker stats failed:", error.message); return []; }
  const used = (toks ?? []).filter((t: { order_id: string | null }) => t.order_id).map((t: { order_id: string }) => t.order_id);
  const paid = new Map<string, number>();
  if (used.length) {
    const { data: os } = await db.from("orders").select("id,status,subtotal_cents,discount_cents,code")
      .in("id", used).in("status", ["paid", "making", "ready", "done"]).not("code", "like", "TEST-%");
    (os ?? []).forEach((o: { id: string; subtotal_cents: number; discount_cents: number }) =>
      paid.set(o.id, o.subtotal_cents - (o.discount_cents ?? 0)));
  }
  const by = new Map<string, { batch: string; printed: number; scanned: number; scans: number; orders: number; food_cents: number }>();
  for (const t of toks ?? []) {
    const b = by.get(t.batch) ?? { batch: t.batch, printed: 0, scanned: 0, scans: 0, orders: 0, food_cents: 0 };
    b.printed++;
    if (t.scan_count > 0) b.scanned++;
    b.scans += t.scan_count;
    if (t.order_id && paid.has(t.order_id)) { b.orders++; b.food_cents += paid.get(t.order_id)!; }
    by.set(t.batch, b);
  }
  return [...by.values()].sort((a, b) => a.batch.localeCompare(b.batch));
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
    .select("code,status,fulfilment,created_at,updated_at,items,subtotal_cents,discount_cents,tax_cents,delivery_fee_cents,tip_cents,total_cents,stripe_payment_intent,paid_at,started_at,ready_at,done_at,source,source_detail,customer_hash")
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
  // repeat customers: the salted fingerprint never leaves this function either —
  // the page gets "customer 1, 2, 3…", numbered in order of first appearance
  const custIndex = new Map<string, number>();
  const orders = (data ?? []).map(({ stripe_payment_intent, customer_hash, ...o }: Record<string, unknown>) => ({
    ...o,
    charged: Boolean(stripe_payment_intent),
    customer: customer_hash
      ? (custIndex.get(customer_hash as string) ??
        (custIndex.set(customer_hash as string, custIndex.size + 1), custIndex.size))
      : null,
    items: ((o.items as { id: string; name: string; qty: number; unit_cents: number }[]) ?? [])
      .map(({ id, name, qty, unit_cents }) => ({ id, name, qty, unit_cents })),
  }));
  const sinceDay = since.slice(0, 10);
  const [{ data: events, error: evErr }, { data: fb, error: fbErr }] = await Promise.all([
    db.from("site_events").select("day,event,item,source,count").gte("day", sinceDay),
    db.from("feedback").select("code,rating,comment,created_at").not("code", "like", "TEST-%").gte("created_at", since).order("created_at", { ascending: false }),
  ]);
  if (evErr || fbErr) console.error("owner-stats extras failed:", evErr?.message, fbErr?.message);
  // sticker A/B/C test, per design (batch): how many printed, scanned, and the
  // paid orders they brought. Totals only; the tokens never leave this function.
  const stickers = await stickerStats(db);
  return json({ orders, events: events ?? [], feedback: fb ?? [], stickers, now: new Date().toISOString() });
});
