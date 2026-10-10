// Stripe webhook — marks orders paid/canceled. verify_jwt is OFF because
// Stripe cannot send a Supabase JWT; authenticity comes from the signature
// check below (STRIPE_WEBHOOK_SECRET / app_config.stripe_webhook_secret).
import { createClient } from "jsr:@supabase/supabase-js@2";

const enc = new TextEncoder();

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  // header format: t=169...,v1=abc,v1=def — MULTIPLE v1 entries during secret rotation
  const pairs = header.split(",").map((kv) => kv.split("=") as [string, string]);
  const t = pairs.find(([k]) => k === "t")?.[1];
  const v1s = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || v1s.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const expected = enc.encode(hex(mac));
  return v1s.some((v) => timingSafeEqual(expected, enc.encode(v)));
}

// shown next to the checkout tickbox (order.html); kept with each subscriber as proof of consent
const OFFERS_CONSENT = "Join Lily's Club: 5% off your next order for joining, then members-only offers and a first look at new dishes, about once a month. Unsubscribe any time.";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  if (!secret) {
    const { data } = await db.from("app_config").select("value").eq("key", "stripe_webhook_secret").maybeSingle();
    secret = data?.value ?? "";
  }
  if (!secret) return new Response("webhook secret not configured", { status: 503 });

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!(await verifySignature(payload, sig, secret))) {
    return new Response("bad signature", { status: 400 });
  }

  const event = JSON.parse(payload);
  const session = event?.data?.object;
  const orderId = session?.metadata?.order_id ?? null;

  // moves a pending order to `to`; returns "ok" | "retry" (5xx → Stripe redelivers)
  const transition = async (to: "paid" | "canceled"): Promise<"ok" | "retry"> => {
    // Stripe asks every customer for an email at payment; keep it so the
    // "your order is ready" email (notify-ready) has somewhere to go
    const email = String(session.customer_details?.email ?? "").trim().toLowerCase();
    const patch = to === "paid"
      ? {
        status: "paid", stripe_payment_intent: session.payment_intent ?? null,
        customer_email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null,
      }
      : { status: "canceled" };
    // match by session id, with metadata.order_id as belt-and-braces fallback
    let q = db.from("orders").update(patch).eq("status", "pending");
    q = orderId ? q.or(`stripe_session_id.eq.${session.id},id.eq.${orderId}`) : q.eq("stripe_session_id", session.id);
    const { data, error } = await q.select("id,offers_opt_in,customer_email");
    if (error) {
      console.error("order update failed:", error.message);
      return "retry";
    }
    if ((data ?? []).length > 0) {
      // ticked "Join Lily's Club" at checkout: join the deals list with the
      // exact wording they agreed to. Ticking it is fresh consent, so it also
      // undoes an earlier unsubscribe; NOT ticking it never touches the list.
      const o = data[0];
      if (to === "paid" && o.offers_opt_in && o.customer_email) {
        const { error: subErr } = await db.from("subscribers").upsert({
          email: o.customer_email, source: "checkout", confirmed_at: new Date().toISOString(),
          unsubscribed_at: null, consent_text: OFFERS_CONSENT, order_id: o.id,
        }, { onConflict: "email" });
        if (subErr) console.error("subscriber add failed:", subErr.message); // the order itself is fine
      }
      return "ok";
    }
    // 0 rows: already processed (idempotent redelivery) or order unknown
    const { data: existing, error: exErr } = await db
      .from("orders")
      .select("id,status")
      .or(orderId ? `stripe_session_id.eq.${session.id},id.eq.${orderId}` : `stripe_session_id.eq.${session.id}`)
      .maybeSingle();
    if (exErr) return "retry";
    if (existing) return "ok"; // already paid/canceled — done
    console.error("webhook for unknown order, session:", session.id);
    return "retry"; // the session-link update may land shortly; let Stripe retry
  };

  let outcome: "ok" | "retry" = "ok";
  if (session?.id) {
    if (event.type === "checkout.session.completed") {
      // async methods (ACH etc.) fire `completed` while still unpaid — only
      // fulfill when the money is actually there
      if (session.payment_status === "paid") outcome = await transition("paid");
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      outcome = await transition("paid");
    } else if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      outcome = await transition("canceled");
    }
  }

  if (outcome === "retry") return new Response("temporary failure — retry", { status: 500 });
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
