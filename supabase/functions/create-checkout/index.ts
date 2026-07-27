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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { items?: CartLine[]; name?: string; phone?: string; notes?: string; test_token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const name = (body.name ?? "").trim().slice(0, 80);
  const phone = (body.phone ?? "").trim().slice(0, 25);
  const notes = (body.notes ?? "").trim().slice(0, 500) || null;
  const testTokenProvided = (body.test_token ?? "").trim().slice(0, 64);
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

  const subtotal = lines.reduce((s, l) => s + l.unit_cents * l.qty, 0);
  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + tax;

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
        tax_cents: tax,
        total_cents: total,
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
  const n = lines.length;
  form.set(`line_items[${n}][quantity]`, "1");
  form.set(`line_items[${n}][price_data][currency]`, "usd");
  form.set(`line_items[${n}][price_data][unit_amount]`, String(tax));
  form.set(`line_items[${n}][price_data][product_data][name]`, taxLabel);

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
