// "How was it? Leave us a Google review" email (2026-10-10). pg_cron calls
// this every 15 minutes; it finds online orders collected 90 minutes to 20
// hours ago and asks each customer once. Reviews are what moves a local
// restaurant up Google Maps, and every online order now carries an email.
//  * Florida daytime only (9am to 9pm): a late order gets its email next morning
//  * once per order, claimed BEFORE sending (review_asked_at), released on failure
//  * one ask per email address per 120 days: a skipped order is stamped
//    1970-01-01, which means "looked at, not sent" and never counts as an ask
//  * everyone is asked the same way. No "only if you were happy" gate:
//    Google bans review gating
//  * links stay on our own domain (spam filters); review.html forwards to Google
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SITE = "https://lilysmediterraneanfresh.com";
const SKIPPED = "1970-01-01T00:00:00Z";
const REPEAT_DAYS = 120;
const floridaHour = (d: Date) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d));

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const now = new Date();
  const hour = floridaHour(now);
  if (hour < 9 || hour >= 21) return json({ ok: true, note: "outside sending hours" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value")
    .in("key", ["resend_api_key", "customer_from", "review_email_enabled"]);
  if (cfgErr) return json({ error: "config read failed" }, 503);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if ((cfg.review_email_enabled ?? "true").trim() === "false") return json({ ok: true, note: "review emails switched off" });
  const apiKey = Deno.env.get("RESEND_API_KEY") || cfg.resend_api_key || "";
  if (!apiKey) return json({ ok: true, note: "email not configured" });

  const { data: due, error } = await db.from("orders")
    .select("id,code,customer_name,customer_email")
    .eq("status", "done").eq("demo", false).is("review_asked_at", null).not("customer_email", "is", null)
    .lte("done_at", new Date(now.getTime() - 90 * 60_000).toISOString())
    .gte("done_at", new Date(now.getTime() - 20 * 3600_000).toISOString())
    .order("done_at").limit(20);
  if (error) return json({ error: "lookup failed" }, 500);

  const sent: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>(); // two orders from one person in the same run
  for (const o of due ?? []) {
    const email = String(o.customer_email).trim().toLowerCase();
    const { data: recent } = await db.from("orders").select("id")
      .eq("customer_email", o.customer_email).neq("id", o.id)
      .gte("review_asked_at", new Date(now.getTime() - REPEAT_DAYS * 86400_000).toISOString()).limit(1);
    const repeat = seen.has(email) || (recent ?? []).length > 0;
    seen.add(email);

    // claim (or mark skipped); only the call that flips it from null goes on
    const { data: claimed } = await db.from("orders")
      .update({ review_asked_at: repeat ? SKIPPED : now.toISOString() })
      .eq("id", o.id).is("review_asked_at", null).select("id");
    if (!claimed?.length) continue;
    if (repeat) { skipped.push(o.code); continue; }

    const first = String(o.customer_name ?? "").trim().split(/\s+/)[0] || "there";
    const link = `${SITE}/review.html?src=review-email`;
    const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1A1E1C">
    <div style="background:#14532b;color:#F4F1E8;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:22px;font-weight:700">Lily's Mediterranean</div>
    </div>
    <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:24px">
      <h1 style="font-size:22px;margin:0 0 10px">How was your food, ${esc(first)}?</h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 20px">Thanks for ordering from Lily's. Would you take 30 seconds to tell people what you thought on Google? Reviews help a small family restaurant more than anything else.</p>
      <p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;background:#B4472B;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 26px;border-radius:99px">Leave a Google review</a></p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 18px">Something not right with your order? Call us at <a href="tel:+13213124444" style="color:#1F5A5F">(321) 312-4444</a> and we'll make it right.</p>
      <p style="font-size:12px;color:#888;margin:0;line-height:1.5">We only ask once. Replies to this email aren't read.<br>
        Lily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903</p>
    </div>
  </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.customer_from || "Lily's Mediterranean <orders@lilysmediterraneanfresh.com>",
        to: [o.customer_email],
        subject: `How was your Lily's order, ${first}?`,
        html,
        text: `How was your food, ${first}?\nThanks for ordering from Lily's. Would you take 30 seconds to leave us a Google review? ${link}\nSomething not right? Call (321) 312-4444 and we'll make it right.\nLily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903`,
      }),
    });
    if (!resp.ok) {
      await db.from("orders").update({ review_asked_at: null }).eq("id", o.id); // retry next run
      console.error("review email failed:", resp.status, await resp.text().catch(() => ""));
      continue;
    }
    sent.push(o.code);
  }
  return json({ ok: true, sent, skipped });
});
