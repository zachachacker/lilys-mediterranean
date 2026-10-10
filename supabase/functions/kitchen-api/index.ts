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

/* ── stock (2026-10-10) ──────────────────────────────────────────────────
   Same four states as Kareem's Sauce menu editor, for dishes and add-ons:
   on, out today (back by itself at 4am Florida time), out until switched
   back, hidden. Stored as out_until + hidden; byte-identical copy of
   stockState in create-checkout/index.ts, which enforces it. */
const OUT_FOREVER = "2999-01-01T00:00:00.000Z";
type StockState = "on" | "today" | "off" | "hidden";

function stockState(outUntil: string | null | undefined, hidden: boolean | null | undefined, now: number): StockState {
  if (hidden) return "hidden";
  const t = outUntil ? Date.parse(outUntil) : NaN;
  if (!Number.isFinite(t) || t <= now) return "on";
  return t >= Date.parse("2900-01-01T00:00:00Z") ? "off" : "today";
}

// The next 4:00am on Florida's clock, as a UTC instant. 4am rather than
// midnight so a late close never brings an item back mid-service.
function nextFloridaMorning(now: Date): string {
  const wall = (d: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  };
  // Florida minus UTC at an instant, in ms (negative)
  const offsetAt = (d: Date) => {
    const w = wall(d);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(d.getTime() / 1000) * 1000;
  };
  const w = wall(now);
  const target = Date.UTC(w.y, w.mo - 1, w.d, 4, 0, 0) + (w.h >= 4 ? 86400000 : 0);
  // offset measured at the target itself, so a DST change overnight still lands on 4am
  const guess = target - offsetAt(now);
  return new Date(target - offsetAt(new Date(guess))).toISOString();
}

function stockPatch(state: StockState, now: Date): { out_until: string | null; hidden: boolean } {
  if (state === "hidden") return { out_until: null, hidden: true };
  if (state === "off") return { out_until: OUT_FOREVER, hidden: false };
  if (state === "today") return { out_until: nextFloridaMorning(now), hidden: false };
  return { out_until: null, hidden: false };
}

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

  let body: { action?: string; id?: string; to?: string; available?: boolean; active?: boolean; kind?: string; state?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  /* ---- stock control ---------------------------------------------------
     Dishes and add-ons, four states each (see stockState above). The same
     columns are what create-checkout refuses on and what the order page
     greys out, so the tablet is only ever a switch. */
  if (body.action === "stock") {
    const [items, opts, groups] = await Promise.all([
      db.from("menu_items").select("id,name,category,orderable,out_until,hidden").eq("orderable", true)
        .order("category").order("name"),
      db.from("addon_options").select("id,name,group_id,sort,out_until,hidden").order("sort"),
      db.from("addon_groups").select("id,label,sort").order("sort"),
    ]);
    const err = items.error ?? opts.error ?? groups.error;
    if (err) {
      console.error("stock list failed:", err.message);
      return json({ error: "Temporarily unavailable" }, 503);
    }
    const now = Date.now();
    return json({
      items: (items.data ?? []).map((i) => ({
        id: i.id, name: i.name, category: i.category,
        state: stockState(i.out_until, i.hidden, now),
        orderable: stockState(i.out_until, i.hidden, now) === "on", // older tablets read this
      })),
      addons: (groups.data ?? []).map((g) => ({
        id: g.id, label: g.label,
        options: (opts.data ?? []).filter((o) => o.group_id === g.id)
          .map((o) => ({ id: o.id, name: o.name, state: stockState(o.out_until, o.hidden, now) })),
      })),
    });
  }

  if (body.action === "set_stock") {
    const id = typeof body.id === "string" ? body.id : "";
    // older tablets send {available: true|false}; new ones send a state
    const state = typeof body.state === "string" ? body.state
      : typeof body.available === "boolean" ? (body.available ? "on" : "off") : "";
    const table = body.kind === "addon" ? "addon_options" : "menu_items";
    if (!id || !["on", "today", "off", "hidden"].includes(state)) {
      return json({ error: "Bad request" }, 400);
    }
    // .select() so a bad id is a 404 rather than a silent no-op — the tablet
    // must never show a toggle as flipped when nothing changed
    const { data, error } = await db
      .from(table)
      .update(stockPatch(state as StockState, new Date()))
      .eq("id", id)
      .select("id,out_until,hidden");
    if (error) {
      console.error("set_stock failed:", error.message);
      return json({ error: "Temporarily unavailable" }, 503);
    }
    if (!(data ?? []).length) return json({ error: "Unknown item" }, 404);
    const now = stockState(data[0].out_until, data[0].hidden, Date.now());
    return json({ ok: true, id, state: now, available: now === "on" });
  }

  /* ---- offers ----------------------------------------------------------
     Switching a promotion on or off, and nothing else. Creating or editing one
     deliberately stays off the tablet: a mistyped percentage here comes out of
     the till on every order that follows, and it would be typed one-handed by
     someone holding a pan. The shapes are authored once, then switched. */
  if (body.action === "promos") {
    const { data, error } = await db
      .from("promotions")
      .select("id,kind,label,active,item_id,buy_qty,free_qty,percent,min_subtotal_cents,starts_at,ends_at,item_ids,categories,days,start_min,end_min")
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
