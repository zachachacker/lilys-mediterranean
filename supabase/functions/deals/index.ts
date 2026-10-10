// Lily's Club, the special-offers email list (2026-10-10). verify_jwt is OFF:
// mail apps send one-click unsubscribes (RFC 8058) with no Supabase key, and
// the club page and the database trigger call it the same way. Everything is
// keyed by unguessable tokens.
//
// No separate "confirm your email" step (Zachary): the first email IS the
// reward. "Welcome to Lily's Club, here's X% off your next order", with one
// Claim button. For a website signup that tap is also the confirmation, so
// nobody can be signed up by someone else; checkout members (they ticked the
// box) are confirmed already and get the same email.
//   POST {action:"join", email}         website signup -> welcome email (unconfirmed until claimed)
//   POST {action:"welcome", email}      trigger, for confirmed members who haven't had one
//   POST {action:"confirm", token}      -> {ok, offer} where offer is the welcome token to apply
//   POST {action:"unsubscribe", token}
//   POST ?u=<token>  "List-Unsubscribe=One-Click"   (Gmail/Yahoo unsubscribe button)
//   GET  ?u=<token>  -> club.html#u=<token> (asks first: link scanners prefetch GETs)
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://lilysmediterraneanfresh.com";
const FN = "https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// shown on club.html next to the signup form; kept with each signup as proof of consent
const SIGNUP_CONSENT = "Join Lily's Club: members-only offers and first look at new dishes, about once a month. Unsubscribe any time.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const promoToken = () => [...crypto.getRandomValues(new Uint8Array(10))].map((b) => ALPHABET[b % 30]).join("");

// deno-lint-ignore no-explicit-any
type DB = any;

async function sendWelcome(db: DB, sub: { email: string; token: string }, percent: number): Promise<boolean> {
  const { data: k } = await db.from("app_config").select("value").eq("key", "resend_api_key").maybeSingle();
  const apiKey = Deno.env.get("RESEND_API_KEY") || k?.value || "";
  if (!apiKey) return false;
  const claim = `${SITE}/club.html#c=${sub.token}`;
  // links in the email stay on our own domain (spam filters distrust a link to
  // another domain); only the List-Unsubscribe header uses the function, since
  // one-click unsubscribe needs an address that accepts a POST
  const unsub = `${SITE}/club.html#u=${sub.token}`;
  const oneClick = `${FN}/deals?u=${sub.token}`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Lily's Club <club@lilysmediterraneanfresh.com>",
      to: [sub.email],
      subject: `Welcome to Lily's Club: ${percent}% off is waiting`,
      headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1A1E1C">
        <div style="background:#14532b;color:#F4F1E8;padding:20px 22px;border-radius:10px 10px 0 0">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#E4A72E;font-weight:700">Members only</div>
          <div style="font-size:24px;font-weight:700;margin-top:4px">Welcome to Lily's Club</div></div>
        <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:24px">
          <p style="font-size:16px;line-height:1.5;margin:0 0 6px">Your welcome gift:</p>
          <div style="font-size:44px;font-weight:800;line-height:1;color:#B4472B;margin:0 0 6px">${percent}% off</div>
          <p style="font-size:16px;line-height:1.5;margin:0 0 20px">your next online order. Tap below and it's applied for you, no code to type.</p>
          <p style="margin:0 0 22px"><a href="${claim}" style="display:inline-block;background:#B4472B;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 26px;border-radius:99px">Claim my ${percent}% off</a></p>
          <p style="font-size:15px;line-height:1.5;margin:0 0 18px">As a member you'll also get our best offers and a first look at new dishes, about once a month.</p>
          <p style="font-size:12px;color:#888;margin:0;line-height:1.5">Didn't sign up? Ignore this and you won't hear from us. <a href="${unsub}" style="color:#888">Unsubscribe</a><br>
            Lily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903 · (321) 312-4444</p>
        </div></div>`,
      text: `Welcome to Lily's Club!\nYour welcome gift: ${percent}% off your next online order.\nClaim it: ${claim}\n\nDidn't sign up? Ignore this. Unsubscribe: ${unsub}\nLily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903`,
    }),
  });
  if (!r.ok) console.error("welcome email failed:", r.status, await r.text().catch(() => ""));
  return r.ok;
}

// claims the one welcome per member, mints its one-use offer, sends the email
async function welcome(db: DB, email: string, requireConfirmed: boolean): Promise<boolean> {
  let q = db.from("subscribers").update({ welcome_sent_at: new Date().toISOString() })
    .eq("email", email).is("welcome_sent_at", null).is("unsubscribed_at", null);
  if (requireConfirmed) q = q.not("confirmed_at", "is", null);
  const { data: rows } = await q.select("email,token,welcome_token");
  const sub = rows?.[0];
  if (!sub) return false;
  const { data: cfg } = await db.from("app_config").select("value").eq("key", "club_welcome_percent").maybeSingle();
  const pct = Number(cfg?.value ?? "5");
  const percent = Number.isInteger(pct) && pct >= 1 && pct <= 50 ? pct : 5;
  // one welcome gift per email, ever: leaving and rejoining reuses the first one
  let error = null;
  if (!sub.welcome_token) {
    const token = promoToken();
    ({ error } = await db.from("promo_tokens").insert({ token, kind: "club", percent, batch: "club-welcome" }));
    if (!error) await db.from("subscribers").update({ welcome_token: token }).eq("email", email);
  }
  const ok = !error && await sendWelcome(db, sub, percent);
  // let a later attempt retry rather than leaving the member without their gift
  if (!ok) await db.from("subscribers").update({ welcome_sent_at: null }).eq("email", email);
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const unsubscribe = async (token: string) => {
    if (!TOKEN_RE.test(token)) return false;
    const { data } = await db.from("subscribers").update({ unsubscribed_at: new Date().toISOString() })
      .eq("token", token).select("email");
    return (data ?? []).length > 0;
  };

  const u = url.searchParams.get("u") ?? "";
  if (u) {
    if (req.method === "GET") return Response.redirect(`${SITE}/club.html#u=${encodeURIComponent(u)}`, 302);
    await unsubscribe(u);
    return new Response("Unsubscribed", { headers: cors });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { action?: string; email?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const email = String(body.email ?? "").trim().toLowerCase();

  if (body.action === "unsubscribe") {
    return (await unsubscribe(String(body.token ?? ""))) ? json({ ok: true }) : json({ error: "That link isn't valid." }, 400);
  }

  if (body.action === "confirm") {
    const token = String(body.token ?? "");
    if (!TOKEN_RE.test(token)) return json({ error: "That link isn't valid." }, 400);
    const { data } = await db.from("subscribers").update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null })
      .eq("token", token).select("welcome_token");
    if (!data?.length) return json({ error: "That link isn't valid." }, 400);
    // hand back the welcome offer only while it's still unused
    const wt = data[0].welcome_token;
    const { data: t } = wt ? await db.from("promo_tokens").select("order_id").eq("token", wt).maybeSingle() : { data: null };
    return json({ ok: true, offer: t && !t.order_id ? wt : null });
  }

  if (body.action === "welcome") {
    if (!EMAIL_RE.test(email)) return json({ error: "bad email" }, 400);
    return json({ ok: await welcome(db, email, true) });
  }

  if (body.action === "join") {
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Please enter a valid email address." }, 400);
    // the same answer every time, so the form can't reveal who is a member
    const done = json({ ok: true });
    const { data: have } = await db.from("subscribers").select("confirmed_at,unsubscribed_at,welcome_sent_at").eq("email", email).maybeSingle();
    if (have && !have.unsubscribed_at && have.welcome_sent_at) return done; // already has their welcome
    if (!have) {
      const { error } = await db.from("subscribers").insert({ email, source: "signup", consent_text: SIGNUP_CONSENT });
      if (error) return json({ error: "Please try again in a moment." }, 503);
    } else if (have.unsubscribed_at) {
      // rejoining: unconfirmed until they tap the new welcome (same gift as before)
      await db.from("subscribers").update({
        unsubscribed_at: null, confirmed_at: null, welcome_sent_at: null, consent_text: SIGNUP_CONSENT,
      }).eq("email", email);
    }
    await welcome(db, email, false);
    return done;
  }
  return json({ error: "Unknown action" }, 400);
});
