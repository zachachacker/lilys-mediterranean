// Reconciliation sweep — the safety net under the webhook. Finds orders stuck
// in `pending` and asks Stripe what actually happened to their session:
// paid → mark paid (recovered order rings the kitchen), expired → canceled.
// Scheduled via pg_cron + pg_net every 15 minutes; safe to call anytime
// (idempotent, self-rate-limited, no-op in demo mode).
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value");
  if (cfgErr) return json({ error: "config read failed" }, 503);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || cfg.stripe_secret_key || "";
  if (!stripeKey) return json({ ok: true, note: "demo mode — nothing to reconcile" });

  // self rate-limit: at most one sweep per 5 minutes, even if called by others
  const last = Number(cfg.reconcile_last_run ?? "0");
  if (Date.now() - last < 5 * 60 * 1000) return json({ ok: true, note: "ran recently" });
  await db.from("app_config").upsert({ key: "reconcile_last_run", value: String(Date.now()) });

  // pending orders older than 10 minutes but younger than 48h, with a session
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: stuck, error } = await db
    .from("orders")
    .select("id,code,stripe_session_id")
    .eq("status", "pending")
    .not("stripe_session_id", "is", null)
    .lt("created_at", tenMinAgo)
    .gt("created_at", twoDaysAgo)
    .limit(50);
  if (error) return json({ error: "orders read failed" }, 503);

  const recovered: string[] = [];
  const expired: string[] = [];
  for (const o of stuck ?? []) {
    try {
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${o.stripe_session_id}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!r.ok) continue; // unknown session — leave for the next sweep
      const s = await r.json();
      if (s.payment_status === "paid") {
        const { data } = await db
          .from("orders")
          .update({ status: "paid", stripe_payment_intent: s.payment_intent ?? null })
          .eq("id", o.id)
          .eq("status", "pending")
          .select("id");
        if ((data ?? []).length) {
          recovered.push(o.code);
          console.error("RECONCILED missed payment:", o.code); // error level so it stands out in logs
        }
      } else if (s.status === "expired") {
        await db.from("orders").update({ status: "canceled" }).eq("id", o.id).eq("status", "pending");
        expired.push(o.code);
      }
    } catch { /* transient — next sweep */ }
  }

  return json({ ok: true, checked: (stuck ?? []).length, recovered, expired });
});
