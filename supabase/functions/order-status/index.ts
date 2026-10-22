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

// Google Ads enhanced conversions (2026-10-22): the buyer's email and phone,
// normalised and SHA-256 hashed HERE, so the page only ever holds the hashes
// it passes to gtag("set", "user_data"). Raw details never reach the browser.
const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
async function adsUserData(email: string | null, phone: string | null) {
  const out: { sha256_email_address?: string; sha256_phone_number?: string } = {};
  const e = (email ?? "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.sha256_email_address = await sha256(e);
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) d = "1" + d; // US number without the country code
  if (d.length === 11 && d.startsWith("1")) out.sha256_phone_number = await sha256("+" + d);
  return Object.keys(out).length ? out : null;
}

// Loyalty progress (2026-10-20; byte-identical in order-status and kitchen-api):
// a customer's paid online orders up to and including `at`, and how many of
// those spent a reward. create-checkout decides the reward itself.
type LoyaltyRow = { created_at: string; discounts: { id?: string }[] | null };
function loyaltyAt(rows: LoyaltyRow[], at: string): { n: number; used: number } {
  const upTo = rows.filter((r) => r.created_at <= at);
  return { n: upTo.length, used: upTo.filter((r) => (r.discounts ?? []).some((d) => d?.id === "loyalty")).length };
}

async function referralFor(
  // deno-lint-ignore no-explicit-any
  db: any,
  o: { status: string; demo: boolean; customer_hash: string | null; code: string },
): Promise<{ token: string; percent: number; thanked: boolean } | null> {
  if (o.demo || !o.customer_hash || o.code.startsWith("TEST-") || !["paid", "making", "ready", "done"].includes(o.status)) return null;
  const { data: cfg } = await db.from("app_config").select("key,value").in("key", ["referral_enabled", "referral_percent"]);
  const c = Object.fromEntries((cfg ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if ((c.referral_enabled ?? "").trim() !== "true") return null;
  const percent = Number(c.referral_percent ?? "10");
  // the referrer's thank-you is once per customer (create-checkout); once it's
  // spent, the share box still offers the friend their discount, nothing more
  const { data: used } = await db.from("referral_rewards").select("used_order_id")
    .eq("customer_hash", o.customer_hash).not("used_order_id", "is", null);
  const usedIds = (used ?? []).map((r: { used_order_id: string }) => r.used_order_id);
  const { count } = usedIds.length
    ? await db.from("orders").select("id", { count: "exact", head: true }).in("id", usedIds).in("status", ["paid", "making", "ready", "done"])
    : { count: 0 };
  const thanked = (count ?? 0) > 0;
  const { data: have } = await db.from("promo_tokens").select("token")
    .eq("kind", "referral").eq("referrer_hash", o.customer_hash).maybeSingle();
  if (have) return { token: have.token, percent, thanked };
  const token = newToken();
  const { error } = await db.from("promo_tokens").insert({ token, kind: "referral", percent, referrer_hash: o.customer_hash });
  if (error) {
    // a parallel poll created it first (one per customer, by unique index)
    const { data: again } = await db.from("promo_tokens").select("token")
      .eq("kind", "referral").eq("referrer_hash", o.customer_hash).maybeSingle();
    return again ? { token: again.token, percent, thanked } : null;
  }
  return { token, percent, thanked };
}

// where this customer stands: shown only to whoever holds this order's session
// id, never looked up by phone number
async function loyaltyFor(
  // deno-lint-ignore no-explicit-any
  db: any,
  o: { status: string; demo: boolean; customer_hash: string | null; code: string; created_at: string; discounts: { id?: string }[] | null },
): Promise<{ n: number; used: number; every: number; cents: number; usedNow: boolean } | null> {
  if (o.demo || !o.customer_hash || o.code.startsWith("TEST-") || o.status === "canceled") return null;
  const { data: cfg } = await db.from("app_config").select("key,value").in("key", ["loyalty_enabled", "loyalty_every", "loyalty_cents"]);
  const c = Object.fromEntries((cfg ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const every = Number(c.loyalty_every ?? "5"), cents = Number(c.loyalty_cents ?? "0");
  if ((c.loyalty_enabled ?? "").trim() !== "true" || !Number.isInteger(every) || every < 2 || !(cents > 0)) return null;
  const { data: rows, error } = await db.from("orders").select("created_at,discounts")
    .eq("customer_hash", o.customer_hash).in("status", ["paid", "making", "ready", "done"]);
  if (error) return null;
  // this order counts even while its payment is still landing
  const all: LoyaltyRow[] = ["paid", "making", "ready", "done"].includes(o.status) ? rows ?? [] : [...(rows ?? []), o];
  return { ...loyaltyAt(all, o.created_at), every, cents, usedNow: (o.discounts ?? []).some((d) => d?.id === "loyalty") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sid = new URL(req.url).searchParams.get("sid") ?? "";
  if (!sid || sid.length > 200) return json({ error: "Missing sid" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db
    .from("orders")
    .select("id,code,status,items,subtotal_cents,discount_cents,discounts,tax_cents,total_cents,created_at,demo,customer_name,fulfilment,delivery_address,delivery_fee_cents,tip_cents,customer_hash,customer_email,customer_phone")
    .eq("stripe_session_id", sid)
    .maybeSingle();
  if (error) return json({ error: "Lookup failed" }, 500);
  if (!data) return json({ error: "Order not found" }, 404);
  // whether this order has been rated, so the page doesn't ask twice; the
  // internal id is used for the lookup and never returned
  const { id, customer_hash, customer_email, customer_phone, discounts, ...order } = data;
  const { data: fb } = await db.from("feedback").select("rating").eq("order_id", id).maybeSingle();
  // offer the one-tap Club join only to someone not already on the list (and
  // not someone who left it); the email itself never leaves this function
  const em = String(customer_email ?? "").trim().toLowerCase();
  let club = false;
  if (em && !data.demo) {
    const { data: sub } = await db.from("subscribers").select("email").eq("email", em).maybeSingle();
    club = !sub;
  }
  return json({
    order: { ...order, rated: fb?.rating ?? null, referral: await referralFor(db, data), club, loyalty: await loyaltyFor(db, data) },
    ads_user: await adsUserData(customer_email, customer_phone),
  });
});
