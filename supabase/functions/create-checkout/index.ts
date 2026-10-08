// Lily's — create an order + Stripe Checkout session.
// Prices come from public.menu_items (server truth), never from the client.
// With no payment provider configured at all, runs in DEMO mode: the order is
// created as paid immediately so the full flow can be shown. A provider that
// is NAMED but not fully configured refuses with 503 — it never falls back.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Florida-time opening hours — keep in sync with data.js HOURS (0=Sun..6=Sat)
const HOURS: Record<number, [number, number] | null> = { 0: [11, 22], 1: [11, 22], 2: [11, 22], 3: null, 4: [11, 22], 5: [11, 23], 6: [11, 23] };

function openNow(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = (parseInt(get("hour"), 10) % 24) + parseInt(get("minute"), 10) / 60;
  const today = HOURS[day];
  return !!today && hour >= today[0] && hour < today[1];
}

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // no 0/O/1/I/L
function makeCode(len = 4, prefix = "LM"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${prefix}-${s}`;
}

// byte-identical to kitchen-api/index.ts:14-21 and square-webhook/index.ts:11-18
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i];
  return out === 0;
}

type CartLine = { id: string; qty: number };

/* ── promotions ──────────────────────────────────────────────────────────
   Discounts are computed HERE, on the server, from the same line prices the
   order is built from. The browser may show a discount but never decides one:
   whatever it sends is ignored. Two kinds only, matching what Kareem asked
   for — a general rules engine is not in scope and would be a bigger surface
   to get wrong on the money path.

     bogo          buy `buy_qty` of one item, the cheapest `free_qty` are free
     percent_over  `percent` off once the subtotal reaches `min_subtotal_cents`

   Order matters: item-level (bogo) applies first and reduces the subtotal that
   percent_over is then measured against, so "10% off over $70" is judged on
   what the customer is actually paying. Discount can never exceed subtotal. */
type Promo = {
  id: string; kind: string; label: string;
  item_id?: string | null; buy_qty?: number | null; free_qty?: number | null;
  percent?: number | null; min_subtotal_cents?: number | null;
};
type PLine = { id: string; qty: number; unit_cents: number };

function applyPromotions(lines: PLine[], promos: Promo[]) {
  const subtotal = lines.reduce((s, l) => s + l.unit_cents * l.qty, 0);
  const applied: { id: string; label: string; cents: number }[] = [];
  let discount = 0;

  for (const p of promos.filter((x) => x.kind === "bogo")) {
    const buy = Math.floor(Number(p.buy_qty ?? 0));
    const free = Math.floor(Number(p.free_qty ?? 0));
    if (!p.item_id || buy <= 0 || free <= 0 || free > buy) continue;
    const line = lines.find((l) => l.id === p.item_id);
    if (!line) continue;
    const sets = Math.floor(line.qty / buy);
    const cents = sets * free * line.unit_cents;
    if (cents > 0) { discount += cents; applied.push({ id: p.id, label: p.label, cents }); }
  }

  const afterItem = Math.max(0, subtotal - discount);
  for (const p of promos.filter((x) => x.kind === "percent_over")) {
    const pct = Number(p.percent ?? 0);
    const min = Number(p.min_subtotal_cents ?? 0);
    if (!(pct > 0 && pct <= 100) || afterItem < min || afterItem <= 0) continue;
    const cents = Math.round((afterItem * pct) / 100);
    if (cents > 0) { discount += cents; applied.push({ id: p.id, label: p.label, cents }); }
  }

  discount = Math.min(discount, subtotal);
  return { subtotal, discount, applied };
}

/* ── delivery ────────────────────────────────────────────────────────────
   Kareem, 2026-10-07: free within 2 miles, $5 to 3.5 miles, $10 to 5 miles,
   nothing beyond; at least $15 of food; customers may tip the driver.
   Distance is a straight line from the restaurant. Lily's sits at the east
   end of the causeway, so it tracks the real drive closely. Like prices and
   discounts, all of this is decided HERE: the order page only shows what the
   quote mode below reports, and whatever fee it sends is ignored. */
const LILYS_LAT = 28.09175;
const LILYS_LON = -80.56608;
const DELIVERY_MAX_MILES = 5;
const DELIVERY_MIN_CENTS = 1500;
const TIP_MAX_CENTS = 10000;

function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(a));
}

function deliveryFeeCents(miles: number): number | null {
  if (!Number.isFinite(miles) || miles < 0 || miles > DELIVERY_MAX_MILES) return null;
  if (miles <= 2) return 0;
  if (miles <= 3.5) return 500;
  return 1000;
}

function parseTipCents(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > TIP_MAX_CENTS) return null;
  return n;
}

// Address lookup. The US Census geocoder (free, keyless, built for US street
// addresses) goes first; it misses some newer and private-road addresses, so
// OpenStreetMap is the fallback. OSM only counts at building level
// (place_rank >= 28): a street- or town-level hit would put the pin in the
// wrong place and quote the wrong fee. A lookup failure is "try again", never
// "too far" — the two must not be confused.
type Geo = { lat: number; lon: number } | "none" | "error";

async function geocodeCensus(address: string): Promise<Geo> {
  try {
    const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    u.searchParams.set("address", address);
    u.searchParams.set("benchmark", "Public_AR_Current");
    u.searchParams.set("format", "json");
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return "error";
    const m = (await r.json())?.result?.addressMatches?.[0]?.coordinates;
    if (!m || !Number.isFinite(m.y) || !Number.isFinite(m.x)) return "none";
    return { lat: m.y, lon: m.x };
  } catch {
    return "error";
  }
}

async function geocodeOsm(address: string): Promise<Geo> {
  try {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", address);
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("countrycodes", "us");
    u.searchParams.set("limit", "1");
    const r = await fetch(u, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "LilysMediterraneanOrdering/1.0 (lilysmediterraneanfresh.com)" },
    });
    if (!r.ok) return "error";
    const hit = (await r.json())?.[0];
    if (!hit || Number(hit.place_rank) < 28) return "none";
    const lat = Number(hit.lat), lon = Number(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : "none";
  } catch {
    return "error";
  }
}

async function geocode(address: string): Promise<Geo> {
  const census = await geocodeCensus(address);
  if (typeof census === "object") return census;
  const osm = await geocodeOsm(address);
  if (typeof osm === "object") return osm;
  // only "none" if neither service could have found it; otherwise retryable
  return census === "error" && osm === "error" ? "error" : census === "none" && osm === "none" ? "none" : "error";
}

async function quoteDelivery(address: string): Promise<
  { ok: true; miles: number; fee_cents: number } | { ok: false; status: number; error: string }
> {
  if (address.length < 6) return { ok: false, status: 400, error: "Please enter your street address, city and ZIP." };
  const g = await geocode(address);
  if (g === "error") return { ok: false, status: 503, error: "We couldn't check that address just now. Please try again, or call us." };
  if (g === "none") return { ok: false, status: 400, error: "We couldn't find that address. Please include the street, city and ZIP." };
  const miles = Math.round(milesBetween(LILYS_LAT, LILYS_LON, g.lat, g.lon) * 100) / 100;
  const fee = deliveryFeeCents(miles);
  if (fee === null) {
    return { ok: false, status: 400, error: `That's ${miles.toFixed(1)} miles away, and we deliver within ${DELIVERY_MAX_MILES} miles. Pickup is always available.` };
  }
  return { ok: true, miles, fee_cents: fee };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: {
    items?: CartLine[]; name?: string; phone?: string; notes?: string;
    action?: string; fulfilment?: string; address?: string; tip_cents?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // quote mode: the order page asks what delivery to an address would cost,
  // using the exact rules the order itself is charged by. Creates nothing.
  if (body.action === "quote") {
    const q = await quoteDelivery(String(body.address ?? "").trim().slice(0, 200));
    return q.ok ? json(q) : json({ error: q.error }, q.status);
  }

  const fulfilment = body.fulfilment === "delivery" ? "delivery" : "pickup";
  const address = String(body.address ?? "").trim().slice(0, 200);
  // tips are for the driver, so only delivery carries one
  const tip = fulfilment === "delivery" ? parseTipCents(body.tip_cents) : 0;
  if (tip === null) return json({ error: "That tip amount doesn't look right." }, 400);

  const name = (body.name ?? "").trim().slice(0, 80);
  const phone = (body.phone ?? "").trim().slice(0, 25);
  // Closed-day test bypass carry (B-4): the secret rides the POST body, typed
  // into the notes box as "#test:<value>" at order time — never a URL, never
  // anything the site serves. The syntax is stripped from the stored notes
  // whether or not the value matches, so a secret is never persisted or shown.
  const notesRaw = (body.notes ?? "").trim().slice(0, 500);
  const testMatch = notesRaw.match(/^#test:(\S+)\s*/);
  const testTokenProvided = testMatch ? testMatch[1] : "";
  const notes = (testMatch ? notesRaw.slice(testMatch[0].length).trim() : notesRaw) || null;
  const items = Array.isArray(body.items) ? body.items : [];

  if (name.length < 2) return json({ error: "Please tell us your name for pickup." }, 400);
  if (phone.replace(/\D/g, "").length < 10) return json({ error: "Please enter a valid phone number." }, 400);
  if (items.length === 0) return json({ error: "Your cart looks empty." }, 400);
  if (items.length > 40) return json({ error: "That's a lot of different dishes! Please call us for orders this size." }, 400);
  for (const line of items) {
    if (typeof line.id !== "string" || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 20) {
      return json({ error: "Invalid cart contents." }, 400);
    }
  }
  const ids = items.map((l) => l.id);
  if (new Set(ids).size !== ids.length) return json({ error: "Duplicate cart lines." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // a failed config read must NEVER silently flip us into demo (free-food) mode
  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value");
  if (cfgErr) {
    console.error("app_config read failed:", cfgErr.message);
    return json({ error: "Ordering is temporarily unavailable — please try again in a moment." }, 503);
  }
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  // provider switch — Kareem chose Square (2026-07-25); Stripe stays a one-key
  // flip. Demo mode ONLY when neither is configured (never a silent fallback).
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || cfg.stripe_secret_key || "";
  const squareToken = Deno.env.get("SQUARE_ACCESS_TOKEN") || cfg.square_access_token || "";
  const squareLocation = cfg.square_location_id || "";
  // same source order as square-webhook — readiness must test the exact key the
  // webhook will use, or "ready" and "able to mark orders paid" can disagree
  const squareSigKey = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") || cfg.square_webhook_signature_key || "";
  const wanted = (cfg.payment_provider || "").trim().toLowerCase();
  // all THREE Square values or we are not live: without the signature key the
  // webhook 503s every delivery, so cards get charged and orders sit `pending`
  // forever, invisible to the kitchen board
  const squareReady = Boolean(squareToken && squareLocation && squareSigKey);
  // a NAMED provider that isn't fully configured is a hard stop BEFORE demo is
  // computed — demo mode exists only for when nobody asked for a provider
  if (wanted === "square" && !squareReady) {
    const missing = [
      !squareToken && "access token",
      !squareLocation && "location id",
      !squareSigKey && "webhook signature key",
    ].filter(Boolean).join(", ");
    console.error(`square selected but not fully configured — missing: ${missing}`);
    return json({ error: "Ordering is temporarily unavailable — please try again in a moment." }, 503);
  }
  if (wanted === "stripe" && !stripeKey) {
    console.error("stripe selected but secret key missing");
    return json({ error: "Ordering is temporarily unavailable — please try again in a moment." }, 503);
  }
  if (wanted && wanted !== "square" && wanted !== "stripe") {
    console.error(`unknown payment_provider "${wanted}" — refusing rather than guessing`);
    return json({ error: "Ordering is temporarily unavailable — please try again in a moment." }, 503);
  }
  const provider = wanted === "square" && squareReady ? "square"
    : wanted === "stripe" && stripeKey ? "stripe"
    : squareReady ? "square"
    : stripeKey ? "stripe"
    : "";
  const demo = !provider;
  const taxRate = Number(cfg.tax_rate ?? "0.07");
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 0.2) {
    console.error("bad tax_rate config:", cfg.tax_rate);
    return json({ error: "Ordering is temporarily unavailable — please try again in a moment." }, 503);
  }
  const siteUrl = (cfg.site_url ?? "").replace(/\/$/, "");

  // Closed-day test bypass (go-live runbook): a real, charged, visibly-marked
  // order for Zachary's live test. The secret lives ONLY in app_config — this
  // repo is publicly served, so it can never live in code. It must match
  // exactly, it skips nothing except the opening-hours refusal below, and in
  // demo mode it does nothing at all.
  const testOrderToken = (cfg.test_order_token ?? "").trim();
  const testOrder = !demo && testOrderToken.length > 0 && testTokenProvided.length > 0 &&
    timingSafeEqual(testTokenProvided, testOrderToken);

  // demo orders may be placed while closed (for showing Kareem); real ones may
  // not — except a token-carrying test order, which rides the full live path
  // delivery is switched by app_config.delivery_enabled, default OFF: Zachary is
  // holding it until Kareem confirms drivers (2026-10-08). Checked before any
  // order row exists, so a forced delivery request never creates anything.
  if (fulfilment === "delivery" && (cfg.delivery_enabled ?? "").trim() !== "true") {
    return json({ error: "Delivery isn't available yet. Pickup is ready in about 30 minutes." }, 409);
  }

  if (!demo && !testOrder && !openNow()) {
    return json({ error: "We're closed right now — online ordering opens with the kitchen." }, 409);
  }

  const { data: menu, error: menuErr } = await db
    .from("menu_items")
    .select("id,name,price_cents,orderable")
    .in("id", ids);
  if (menuErr) return json({ error: "Menu lookup failed." }, 500);
  const byId = new Map((menu ?? []).map((m: { id: string; name: string; price_cents: number; orderable: boolean }) => [m.id, m]));

  const lines: { id: string; name: string; qty: number; unit_cents: number }[] = [];
  for (const l of items) {
    const m = byId.get(l.id);
    if (!m || !m.orderable) return json({ error: `Sorry — an item in your cart isn't available online.` }, 400);
    lines.push({ id: m.id, name: m.name, qty: l.qty, unit_cents: m.price_cents });
  }

  // active promotions, read server-side. A failed read must not silently drop
  // a discount the customer was shown, so it is a hard error rather than [].
  let promos: Promo[] = [];
  {
    const nowIso = new Date().toISOString();
    const { data, error } = await db
      .from("promotions")
      .select("id,kind,label,item_id,buy_qty,free_qty,percent,min_subtotal_cents")
      .eq("active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`);
    if (error) {
      console.error("promotions read failed:", error.message);
      return json({ error: "Ordering is temporarily unavailable — please try again in a moment." }, 503);
    }
    promos = (data ?? []) as Promo[];
  }

  const { subtotal, discount, applied } = applyPromotions(lines, promos);

  let deliveryMiles: number | null = null;
  let deliveryFee = 0;
  if (fulfilment === "delivery") {
    if (subtotal - discount < DELIVERY_MIN_CENTS) {
      return json({ error: "Delivery needs at least $15 of food. Add a little more, or choose pickup." }, 400);
    }
    const q = await quoteDelivery(address);
    if (!q.ok) return json({ error: q.error }, q.status);
    deliveryMiles = q.miles;
    deliveryFee = q.fee_cents;
  }

  // tax on what is actually paid, not the pre-discount figure
  const tax = Math.round((subtotal - discount) * taxRate);
  // delivery fee is separately stated and optional (pickup is always offered),
  // so it is not taxed; tips are voluntary and never taxed
  const total = subtotal - discount + tax + deliveryFee + tip;

  // the Square path below charges line items only: it has no coupon, fee or
  // tip support. Refuse rather than charge a total that differs from the order.
  if (provider === "square" && (discount > 0 || deliveryFee > 0 || tip > 0)) {
    console.error("square cannot charge discounts/delivery/tips — refusing");
    return json({ error: "Ordering is temporarily unavailable — please try again in a moment." }, 503);
  }

  // insert with a fresh code; retry on the (unlikely) code collision
  let order: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    const { data, error } = await db
      .from("orders")
      .insert({
        // test orders are loudly marked: TEST- code (kitchen board, confirmation
        // page, Square reference) and a notes tag the kitchen ticket shows
        code: makeCode(attempt < 2 ? 4 : 5, testOrder ? "TEST" : "LM"),
        status: demo ? "paid" : "pending",
        customer_name: name,
        customer_phone: phone,
        notes: testOrder ? `[SYSTEM TEST ORDER] ${notes ?? ""}`.trim() : notes,
        items: lines,
        subtotal_cents: subtotal,
        discount_cents: discount,
        discounts: applied.length ? applied : null,
        tax_cents: tax,
        total_cents: total,
        fulfilment,
        delivery_address: fulfilment === "delivery" ? address : null,
        delivery_miles: deliveryMiles,
        delivery_fee_cents: deliveryFee,
        tip_cents: tip,
        demo,
        payment_provider: demo ? "demo" : provider,
        // our own session token — the confirmation page looks orders up by it.
        // Stripe overwrites this with its real session id below; Square has no
        // redirect placeholder, so it carries this token through instead.
        stripe_session_id: demo ? `demo_${crypto.randomUUID()}` : `sq_${crypto.randomUUID()}`,
      })
      .select("id,code,stripe_session_id")
      .single();
    if (!error) order = data;
    else if (!String(error.message).includes("duplicate")) return json({ error: "Could not create the order." }, 500);
  }
  if (!order) return json({ error: "Could not create the order." }, 500);

  const sid = (order as unknown as { stripe_session_id: string }).stripe_session_id;
  const taxLabel = `FL sales tax (${+(taxRate * 100).toFixed(2)}%)`; // 0.07*100 → 7, not 7.000000000000001

  if (demo) {
    return json({ url: `order-confirmed.html?sid=${sid}`, demo: true, code: order.code });
  }

  /* ------------------------------------------------------------- Square ---
     Square Payment Links. Unlike Stripe there's no {SESSION_ID} placeholder
     for the redirect, so we mint our own token (sid) and carry it through. */
  if (provider === "square") {
    const apiVersion = cfg.square_api_version || "2025-01-23";
    const money = (amount: number) => ({ amount, currency: "USD" });
    const payload = {
      idempotency_key: order.id, // one payment link per order, ever
      order: {
        location_id: squareLocation,
        reference_id: order.code,
        line_items: [
          ...lines.map((l) => ({
            name: l.name,
            quantity: String(l.qty),
            base_price_money: money(l.unit_cents),
          })),
          { name: taxLabel, quantity: "1", base_price_money: money(tax) },
        ],
      },
      checkout_options: {
        redirect_url: `${siteUrl}/order-confirmed.html?sid=${sid}`,
        ask_for_shipping_address: false,
      },
      pre_populated_data: { buyer_phone_number: phone },
    };

    let link: { payment_link?: { url?: string; order_id?: string }; errors?: { detail?: string }[] };
    try {
      const resp = await fetch("https://connect.squareup.com/v2/online-checkout/payment-links", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${squareToken}`,
          "Square-Version": apiVersion,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      link = await resp.json();
      if (!resp.ok || !link.payment_link?.url) {
        throw new Error(link?.errors?.[0]?.detail || `HTTP ${resp.status}`);
      }
    } catch (ex) {
      await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
      console.error("square error:", ex instanceof Error ? ex.message : ex);
      return json({ error: "Payment setup failed — please call us to order." }, 502);
    }

    // the webhook matches on Square's order id — if we can't record it, we'd
    // take money we couldn't attach to a ticket, so fail before the customer pays
    const { error: linkErr } = await db
      .from("orders")
      .update({ provider_order_id: link.payment_link.order_id ?? null })
      .eq("id", order.id);
    if (linkErr) {
      console.error("square order link failed:", linkErr.message);
      await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
      return json({ error: "Something went wrong — please try again." }, 500);
    }
    return json({ url: link.payment_link.url, demo: false, code: order.code });
  }

  // real Stripe Checkout session — card only (Apple/Google Pay ride on card);
  // async methods (ACH, BNPL) would "complete" unpaid and must stay off
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("payment_method_types[0]", "card");
  form.set("success_url", `${siteUrl}/order-confirmed.html?sid={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${siteUrl}/order.html?canceled=1`);
  form.set("expires_at", String(Math.floor(Date.now() / 1000) + 3600)); // 1h — comfortably over Stripe's 30-min floor despite clock skew
  form.set("metadata[order_id]", order.id);
  form.set("metadata[code]", order.code);
  form.set("payment_intent_data[metadata][order_id]", order.id);
  lines.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty));
    form.set(`line_items[${i}][price_data][currency]`, "usd");
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.unit_cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
  });
  const extras: [string, number][] = [[taxLabel, tax]];
  if (deliveryFee > 0) extras.push([`Delivery (${deliveryMiles?.toFixed(1)} mi)`, deliveryFee]);
  if (tip > 0) extras.push(["Driver tip", tip]);
  extras.forEach(([label, cents], j) => {
    const n = lines.length + j;
    form.set(`line_items[${n}][quantity]`, "1");
    form.set(`line_items[${n}][price_data][currency]`, "usd");
    form.set(`line_items[${n}][price_data][unit_amount]`, String(cents));
    form.set(`line_items[${n}][price_data][product_data][name]`, label);
  });

  // Stripe line items can't be negative, so a discount must travel as a coupon
  // or the customer is charged full price for an order recorded as discounted.
  // One coupon per order, for exactly the amount computed above, usable once.
  if (discount > 0) {
    const c = new URLSearchParams();
    c.set("amount_off", String(discount));
    c.set("currency", "usd");
    c.set("duration", "once");
    c.set("max_redemptions", "1");
    c.set("name", applied.map((a) => a.label).join(", ").slice(0, 40) || "Offer");
    let coupon: { id?: string; error?: { message?: string } };
    try {
      const cr = await fetch("https://api.stripe.com/v1/coupons", {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: c,
      });
      coupon = await cr.json();
      if (!cr.ok || !coupon.id) throw new Error(coupon?.error?.message || `HTTP ${cr.status}`);
    } catch (ex) {
      await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
      console.error("stripe coupon error:", ex instanceof Error ? ex.message : ex);
      return json({ error: "Payment setup failed — please call us to order." }, 502);
    }
    form.set("discounts[0][coupon]", coupon.id);
  }

  let session: { id?: string; url?: string; error?: { message?: string } };
  try {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    session = await resp.json();
    if (!resp.ok || !session.url) throw new Error(session?.error?.message || `HTTP ${resp.status}`);
  } catch (ex) {
    await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
    console.error("stripe error:", ex instanceof Error ? ex.message : ex);
    return json({ error: "Payment setup failed — please call us to order." }, 502);
  }

  // the customer must never be sent to pay for an order we can't find again
  const { error: linkErr } = await db.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);
  if (linkErr) {
    console.error("session link failed:", linkErr.message);
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/expire`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}` },
    }).catch(() => {});
    await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
    return json({ error: "Something went wrong — please try again." }, 500);
  }
  return json({ url: session.url, demo: false, code: order.code });
});
