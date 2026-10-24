// Lily's Club accounts + points (2026-10-24). Sign-in is an email and a
// 6-digit code (no passwords); the browser then keeps a session token, sent as
// x-club-token. Points are derived from orders every time (see clubPoints and
// migrations/20261024_club_points.sql), so there is no balance to drift.
//   POST {action:"send_code", email}
//   POST {action:"verify", email, code, offers?}  -> {token}
//   POST {action:"me"}                            -> member, points, rewards, recent orders
//   POST {action:"set_offers", on}                -> join / leave the offers email list
//   POST {action:"sign_out"}
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://lilysmediterraneanfresh.com";
const FN = "https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-club-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// stricter than the checkout's: these emails go inside a PostgREST or() filter
const CLUB_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;          // wrong codes before a new one is needed
const MAX_SENDS_PER_HOUR = 5;
// shown next to the offers tickbox on club.html; kept as proof of consent
const OFFERS_CONSENT = "Email me Lily's Club offers: 10% off my next order for joining, then members-only offers about once a month. Unsubscribe any time.";
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const memberCode = () => [...crypto.getRandomValues(new Uint8Array(10))].map((b) => ALPHABET[b % 30]).join("");
const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");

/* ── Lily's Club points (2026-10-24; byte-identical in club/index.ts and
   create-checkout/index.ts, checked by club_points_test.ts) ────────────── */
type ClubOrder = {
  subtotal_cents: number | null; discount_cents: number | null; status: string; created_at: string; demo: boolean | null;
  customer_email: string | null; club_email: string | null; discounts: { id?: string; email?: string; points?: number }[] | null;
};
const CLUB_PAID = ["paid", "making", "ready", "done"];
const CLUB_HOLD_MS = 2 * 3600 * 1000; // a reward on an unpaid checkout is held this long
function clubPoints(email: string, orders: ClubOrder[], adjust: number, now: number): { earned: number; spent: number; balance: number } {
  let earned = 0, spent = 0;
  for (const o of orders) {
    const paid = CLUB_PAID.includes(o.status);
    const mine = (o.customer_email ?? "").toLowerCase() === email || o.club_email === email;
    // $1 of food after discounts = 1 point; tax, delivery and tips earn nothing
    if (paid && mine && !o.demo) earned += Math.floor(Math.max(0, (o.subtotal_cents ?? 0) - (o.discount_cents ?? 0)) / 100);
    const held = paid || (o.status === "pending" && now - Date.parse(o.created_at) < CLUB_HOLD_MS);
    if (held) for (const d of o.discounts ?? []) if (d?.id === "club-points" && d.email === email) spent += Number(d.points) || 0;
  }
  return { earned, spent, balance: earned + adjust - spent };
}
function clubTiers(raw: string | undefined): { points: number; cents: number }[] {
  return String(raw ?? "").split(",").map((s) => s.split(":").map(Number))
    .filter(([p, c]) => Number.isInteger(p) && p > 0 && Number.isInteger(c) && c > 0)
    .map(([points, cents]) => ({ points, cents })).sort((a, b) => a.points - b.points);
}
/* ── end of the shared copy ─────────────────────────────────────────── */

// deno-lint-ignore no-explicit-any
type DB = any;

async function sendCode(db: DB, email: string, code: string): Promise<boolean> {
  const { data: k } = await db.from("app_config").select("value").eq("key", "resend_api_key").maybeSingle();
  const apiKey = Deno.env.get("RESEND_API_KEY") || k?.value || "";
  if (!apiKey) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Lily's Club <club@lilysmediterraneanfresh.com>",
      to: [email],
      subject: `${code} is your Lily's Club code`,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1A1E1C">
        <div style="background:#14532b;color:#F4F1E8;padding:20px 22px;border-radius:10px 10px 0 0">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#E4A72E;font-weight:700">Lily's Club</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px">Your sign-in code</div></div>
        <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:24px">
          <div style="font-size:40px;font-weight:800;letter-spacing:8px;margin:0 0 14px">${code}</div>
          <p style="font-size:15px;line-height:1.5;margin:0 0 18px">Type it on the Lily's Club page. It works for 10 minutes.</p>
          <p style="font-size:12px;color:#888;margin:0;line-height:1.5">Didn't ask for this? Ignore it and nothing happens.<br>
            Lily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903 · (321) 312-4444</p>
        </div></div>`,
      text: `Your Lily's Club code: ${code}\nIt works for 10 minutes. Didn't ask for this? Ignore it.\n${SITE}/club.html`,
    }),
  });
  if (!r.ok) console.error("club code email failed:", r.status, await r.text().catch(() => ""));
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { action?: string; email?: string; code?: string; offers?: unknown; on?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const email = String(body.email ?? "").trim().toLowerCase();

  if (body.action === "send_code") {
    if (!CLUB_EMAIL_RE.test(email) || email.length > 254) return json({ error: "Please enter a valid email address." }, 400);
    const now = Date.now();
    const { data: prev } = await db.from("club_codes").select("sent_count,window_start").eq("email", email).maybeSingle();
    const fresh = !prev || now - Date.parse(prev.window_start) > 3600 * 1000;
    if (!fresh && prev.sent_count >= MAX_SENDS_PER_HOUR) {
      return json({ error: "Too many codes asked for. Please wait an hour, or use the last code we sent." }, 429);
    }
    const code = sixDigits();
    const { error } = await db.from("club_codes").upsert({
      email, code_hash: await sha256(`${email}:${code}`), expires_at: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0, sent_count: fresh ? 1 : prev.sent_count + 1, window_start: fresh ? new Date(now).toISOString() : prev.window_start,
    });
    if (error) return json({ error: "Please try again in a moment." }, 503);
    if (!(await sendCode(db, email, code))) return json({ error: "We couldn't send the email. Please try again in a moment." }, 503);
    return json({ ok: true });
  }

  if (body.action === "verify") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (!CLUB_EMAIL_RE.test(email) || code.length !== 6) return json({ error: "Please type the 6-digit code from the email." }, 400);
    const { data: row } = await db.from("club_codes").select("code_hash,expires_at,attempts").eq("email", email).maybeSingle();
    if (!row || Date.parse(row.expires_at) < Date.now() || row.attempts >= MAX_TRIES) {
      return json({ error: "That code has expired. Tap \"Send a new code\"." }, 400);
    }
    if (row.code_hash !== await sha256(`${email}:${code}`)) {
      await db.from("club_codes").update({ attempts: row.attempts + 1 }).eq("email", email);
      return json({ error: "That code isn't right. Check the email and try again." }, 400);
    }
    await db.from("club_codes").delete().eq("email", email);
    const { data: have } = await db.from("club_members").select("email").eq("email", email).maybeSingle();
    if (!have) {
      const { error } = await db.from("club_members").insert({ email, member_code: memberCode() });
      if (error && !String(error.message).includes("duplicate")) return json({ error: "Please try again in a moment." }, 503);
    }
    const token = randomHex(32);
    const { error: sErr } = await db.from("club_sessions").insert({ token_hash: await sha256(token), email });
    if (sErr) return json({ error: "Please try again in a moment." }, 503);
    if (body.offers === true) await joinOffers(db, email);
    return json({ ok: true, token });
  }

  // everything below needs a signed-in member
  const tok = req.headers.get("x-club-token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(tok)) return json({ error: "Please sign in again.", signin: true }, 401);
  const tokenHash = await sha256(tok);
  const { data: sess } = await db.from("club_sessions").select("email,last_seen_at").eq("token_hash", tokenHash).maybeSingle();
  if (!sess) return json({ error: "Please sign in again.", signin: true }, 401);
  const me = sess.email as string;
  if (Date.now() - Date.parse(sess.last_seen_at) > 3600 * 1000) {
    await db.from("club_sessions").update({ last_seen_at: new Date().toISOString() }).eq("token_hash", tokenHash);
  }

  if (body.action === "sign_out") {
    await db.from("club_sessions").delete().eq("token_hash", tokenHash);
    return json({ ok: true });
  }

  if (body.action === "set_offers") {
    if (body.on === true) await joinOffers(db, me);
    else await db.from("subscribers").update({ unsubscribed_at: new Date().toISOString() }).eq("email", me);
    return json({ ok: true });
  }

  if (body.action === "me") {
    const [mem, ords, adj, cfgRows, sub] = await Promise.all([
      db.from("club_members").select("email,name,member_code,created_at").eq("email", me).maybeSingle(),
      db.from("orders").select("code,subtotal_cents,discount_cents,status,created_at,demo,customer_email,club_email,discounts")
        .or(`customer_email.eq.${me},club_email.eq.${me}`).order("created_at", { ascending: false }).limit(500),
      db.from("club_points").select("delta,reason,created_at").eq("email", me).order("created_at", { ascending: false }),
      db.from("app_config").select("key,value").in("key", ["club_points_enabled", "club_reward_tiers"]),
      db.from("subscribers").select("unsubscribed_at").eq("email", me).maybeSingle(),
    ]);
    if (mem.error || ords.error || adj.error || !mem.data) return json({ error: "Please try again in a moment." }, 503);
    const cfg = Object.fromEntries((cfgRows.data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const orders = (ords.data ?? []) as (ClubOrder & { code: string })[];
    const adjust = (adj.data ?? []).reduce((s: number, r: { delta: number }) => s + r.delta, 0);
    const pts = clubPoints(me, orders, adjust, Date.now());
    return json({
      email: me,
      name: mem.data.name,
      member_code: mem.data.member_code,
      on: (cfg.club_points_enabled ?? "").trim() === "true",
      points: Math.max(0, pts.balance),
      tiers: clubTiers(cfg.club_reward_tiers),
      offers: !!sub.data && !sub.data.unsubscribed_at,
      // recent paid orders and what each earned or spent
      history: orders.filter((o) => CLUB_PAID.includes(o.status) && !o.demo).slice(0, 10).map((o) => ({
        code: o.code, at: o.created_at,
        earned: clubPoints(me, [o], 0, 0).earned,
        spent: clubPoints(me, [o], 0, 0).spent,
      })),
    });
  }

  return json({ error: "Unknown action" }, 400);
});

// ticked "email me offers": the code just proved the address, so the member
// is confirmed straight away and the usual welcome (10% off) goes out once
async function joinOffers(db: DB, email: string) {
  const now = new Date().toISOString();
  const { data: have } = await db.from("subscribers").select("email").eq("email", email).maybeSingle();
  const { error } = have
    ? await db.from("subscribers").update({ confirmed_at: now, unsubscribed_at: null, consent_text: OFFERS_CONSENT }).eq("email", email)
    : await db.from("subscribers").insert({ email, source: "club-account", confirmed_at: now, consent_text: OFFERS_CONSENT });
  if (error) { console.error("club offers join failed:", error.message); return; }
  await fetch(`${FN}/deals`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "welcome", email }),
  }).catch(() => {});
}
