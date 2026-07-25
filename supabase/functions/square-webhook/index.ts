// Square payment webhook — flips an order pending -> paid once Square confirms
// the money landed. Mirrors stripe-webhook. Signature: HMAC-SHA256 over
// (notification URL + raw body), base64, in x-square-hmacsha256-signature.
// verify_jwt must be OFF (Square can't send a Supabase JWT); the signature IS
// the authentication, so an unverifiable request is rejected outright.
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i];
  return out === 0;
}

async function expectedSignature(key: string, notificationUrl: string, body: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(notificationUrl + body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const raw = await req.text();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value");
  if (cfgErr) {
    console.error("config read failed:", cfgErr.message);
    return json({ error: "temporarily unavailable" }, 503); // Square retries
  }
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const sigKey = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") || cfg.square_webhook_signature_key || "";
  // the URL Square signed against must match exactly what's registered in the
  // Square dashboard, so it's config rather than guessed from the request
  const notificationUrl = cfg.square_webhook_url ||
    `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "")}/functions/v1/square-webhook`;

  if (!sigKey) {
    console.error("square webhook signature key not configured — rejecting");
    return json({ error: "not configured" }, 503);
  }
  const provided = req.headers.get("x-square-hmacsha256-signature") ?? "";
  const expected = await expectedSignature(sigKey, notificationUrl, raw);
  if (!provided || !timingSafeEqual(provided, expected)) {
    console.error("square webhook signature mismatch");
    return json({ error: "bad signature" }, 401);
  }

  let event: {
    type?: string;
    data?: { object?: { payment?: { order_id?: string; status?: string; id?: string } } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const payment = event.data?.object?.payment;
  const type = event.type ?? "";
  // only a COMPLETED payment means the money is actually captured
  if (!type.startsWith("payment.") || !payment || payment.status !== "COMPLETED") {
    return json({ ok: true, ignored: type || "unknown" });
  }
  if (!payment.order_id) {
    console.error("completed payment with no order_id", payment.id);
    return json({ ok: true, note: "no order_id" });
  }

  // pending -> paid only: idempotent under Square's at-least-once retries, and
  // it can never resurrect an order the kitchen already canceled
  const { data, error } = await db
    .from("orders")
    .update({ status: "paid", provider_payment_id: payment.id ?? null })
    .eq("provider_order_id", payment.order_id)
    .eq("status", "pending")
    .select("id,code");
  if (error) {
    console.error("order update failed:", error.message);
    return json({ error: "update failed" }, 503); // 503 => Square retries
  }
  if (!(data ?? []).length) {
    // already paid (duplicate delivery) or unknown order — both are terminal
    return json({ ok: true, note: "no pending order matched" });
  }
  console.log("square payment confirmed for", data[0].code);
  return json({ ok: true, code: data[0].code });
});
