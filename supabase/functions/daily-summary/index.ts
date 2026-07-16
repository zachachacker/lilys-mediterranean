// Daily sales digest — emails the owner yesterday's numbers each morning.
// Scheduled via pg_cron (08:30 ET). Dormant until app_config.resend_api_key
// + notify_email are set. Skips quietly when there were no real orders.
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const flDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value");
  if (cfgErr) return json({ error: "config read failed" }, 503);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if (!cfg.resend_api_key || !cfg.notify_email) return json({ ok: true, note: "email channel not configured" });

  const yesterday = flDate(new Date(Date.now() - 24 * 3600 * 1000));
  const { data: rows, error } = await db
    .from("orders")
    .select("status,items,total_cents,created_at,demo")
    .gte("created_at", new Date(Date.now() - 55 * 3600 * 1000).toISOString());
  if (error) return json({ error: "orders read failed" }, 503);

  const day = (rows ?? []).filter((o) => flDate(new Date(o.created_at)) === yesterday && !o.demo);
  const fulfilled = day.filter((o) => o.status !== "canceled");
  if (fulfilled.length === 0) return json({ ok: true, note: "no real orders yesterday — no email" });

  const revenue = fulfilled.reduce((s, o) => s + o.total_cents, 0);
  const canceled = day.length - fulfilled.length;
  const counts = new Map<string, number>();
  fulfilled.forEach((o) => (o.items ?? []).forEach((l: { name: string; qty: number }) =>
    counts.set(l.name, (counts.get(l.name) ?? 0) + l.qty)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, qty]) => `<tr><td style="padding:3px 12px 3px 0;font-weight:700">${qty}×</td><td style="padding:3px 0">${esc(name)}</td></tr>`)
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px">
      <h2 style="margin:0 0 4px">Lily's — ${yesterday}</h2>
      <p style="font-size:28px;margin:8px 0"><b>${fulfilled.length}</b> orders · <b>${money(revenue)}</b></p>
      <p style="margin:0 0 16px;color:#555">avg ticket ${money(Math.round(revenue / fulfilled.length))}${canceled ? ` · ${canceled} canceled` : ""}</p>
      <p style="margin:0 0 6px;font-weight:700">Most ordered</p>
      <table style="border-collapse:collapse;font-size:15px">${top}</table>
      <p style="color:#888;font-size:13px;margin-top:16px">Online pickup orders only — Lily's ordering system</p>
    </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.resend_api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.notify_from || "Lily's Orders <onboarding@resend.dev>",
      to: [cfg.notify_email],
      subject: `Lily's yesterday: ${fulfilled.length} orders · ${money(revenue)}`,
      html,
    }),
  });
  if (!resp.ok) {
    console.error("resend failed:", resp.status, await resp.text().catch(() => ""));
    return json({ error: "send failed" }, 502);
  }
  return json({ ok: true, orders: fulfilled.length, revenue });
});
