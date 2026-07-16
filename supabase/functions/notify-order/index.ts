// Order notification email — the backup channel behind the kitchen tablet.
// Fired by a DB trigger whenever an order becomes paid (pg_net → here).
// Dormant until app_config.resend_api_key is set. Idempotent via
// orders.notified_at, and only notifies fresh orders (no back-spam when
// the key is added later).
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const orderId = String(body.order_id ?? "");
  if (!orderId) return json({ error: "order_id required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value");
  if (cfgErr) return json({ error: "config read failed" }, 503);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const apiKey = cfg.resend_api_key || "";
  const to = cfg.notify_email || "";
  if (!apiKey || !to) return json({ ok: true, note: "email channel not configured" });

  const { data: o, error } = await db
    .from("orders")
    .select("id,code,status,customer_name,customer_phone,notes,items,total_cents,created_at,demo,notified_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !o) return json({ error: "order not found" }, 404);
  if (o.notified_at) return json({ ok: true, note: "already notified" });
  if (Date.now() - new Date(o.created_at).getTime() > 3600_000) {
    return json({ ok: true, note: "stale order — skipping" });
  }

  const items = (o.items ?? [])
    .map((l: { qty: number; name: string }) => `<tr><td style="padding:4px 12px 4px 0;font-weight:700">${l.qty}×</td><td style="padding:4px 0">${esc(l.name)}</td></tr>`)
    .join("");
  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px">
      <h2 style="margin:0 0 4px">${o.demo ? "[TEST] " : ""}New pickup order ${esc(o.code)}</h2>
      <p style="margin:0 0 16px;color:#555">${esc(o.customer_name)} · ${esc(o.customer_phone)} · ${money(o.total_cents)} paid online</p>
      <table style="border-collapse:collapse;font-size:16px">${items}</table>
      ${o.notes ? `<p style="background:#fdf3dd;border-left:4px solid #E4A72E;padding:8px 12px;font-size:15px"><b>Note:</b> ${esc(o.notes)}</p>` : ""}
      <p style="color:#888;font-size:13px">Placed ${new Date(o.created_at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} — Lily's online ordering</p>
    </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.notify_from || "Lily's Orders <onboarding@resend.dev>",
      to: [to],
      subject: `${o.demo ? "[TEST] " : ""}New order ${o.code} — ${money(o.total_cents)} — ${o.customer_name}`,
      html,
    }),
  });
  if (!resp.ok) {
    console.error("resend failed:", resp.status, await resp.text().catch(() => ""));
    return json({ error: "send failed" }, 502);
  }

  await db.from("orders").update({ notified_at: new Date().toISOString() }).eq("id", o.id);
  return json({ ok: true, sent: o.code });
});
