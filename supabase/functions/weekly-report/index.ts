// Weekly owner report (2026-10-19). Monday morning email to Kareem: last
// week's website orders, food sales, NEW vs RETURNING customers, where they
// came from, and best sellers. pg_cron calls it Mondays 08:45 ET.
//  * the week is Monday to Sunday on Florida's clock
//  * "new" = the customer's first ever counted order falls inside the week
//    (same idea as create-checkout firstOrder); the salted customer_hash
//    never leaves this function
//  * sends once per week: weekly_report_last_week is claimed before sending
//    and released on failure, so a cron retry or a stray call can't resend
//  * the response carries no numbers (anyone with the anon key can call it)
// Config (app_config): notify_email (or weekly_report_to), weekly_report_cc,
// weekly_report_enabled, weekly_report_baseline (orders/month included in the
// fixed fee; shows the bonus line when set), ads_spend_week ("YYYY-MM-DD:dollars",
// the Monday it applies to; shows cost per new customer when it matches).
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---- pure helpers (mirrored in _tests/mirrors.ts) ---------------------- */
export const COUNTED = ["paid", "making", "ready", "done"];
export const SOURCE_NAMES: Record<string, string> = {
  "google-ads": "Google Ads", google: "Google search", direct: "Direct / typed in", instagram: "Instagram",
  facebook: "Facebook", tiktok: "TikTok", yelp: "Yelp", tripadvisor: "TripAdvisor", bing: "Bing",
  duckduckgo: "DuckDuckGo", sticker: "Bag sticker", ubereats: "Uber Eats", doordash: "DoorDash",
  gbp: "Google listing", "gbp-order": "Google \"Order online\" button", "old-site": "Old website",
  qr: "QR code", flyer: "Flyer", email: "Lily's Club email", club: "Lily's Club welcome",
  referral: "Friend's link", "ready-email": "Order-ready email", "review-email": "Review email",
};
export const flDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Last full Monday-to-Sunday week before `today` (YYYY-MM-DD, Florida). */
export function lastWeek(today: string): { start: string; end: string } {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const start = addDays(today, -((dow + 6) % 7) - 7);
  return { start, end: addDays(start, 6) };
}

export type Ord = {
  created_at: string; status: string; subtotal_cents: number; discount_cents: number | null;
  customer_hash: string | null; source: string | null; items: { name: string; qty: number }[] | null;
};
export type Week = {
  orders: number; sales: number; newCustomers: number; returningCustomers: number; untracked: number;
  bySource: { source: string; label: string; orders: number; newCustomers: number }[];
  top: { name: string; qty: number }[];
  prev: { orders: number; sales: number; newCustomers: number };
  monthOrders: number;
};

export function summarize(all: Ord[], start: string, end: string): Week {
  const counted = all.filter((o) => COUNTED.includes(o.status)).map((o) => ({ ...o, day: flDate(o.created_at) }));
  const firstDay = new Map<string, string>();
  for (const o of counted) {
    if (!o.customer_hash) continue;
    const seen = firstDay.get(o.customer_hash);
    if (!seen || o.day < seen) firstDay.set(o.customer_hash, o.day);
  }
  const inRange = (a: string, b: string) => counted.filter((o) => o.day >= a && o.day <= b);
  const sales = (os: typeof counted) => os.reduce((s, o) => s + o.subtotal_cents - (o.discount_cents ?? 0), 0);
  const isNew = (h: string, a: string, b: string) => { const f = firstDay.get(h)!; return f >= a && f <= b; };
  const newIn = (os: typeof counted, a: string, b: string) =>
    new Set(os.filter((o) => o.customer_hash && isNew(o.customer_hash, a, b)).map((o) => o.customer_hash)).size;

  const week = inRange(start, end);
  const pStart = addDays(start, -7), pEnd = addDays(start, -1);
  const prevWeek = inRange(pStart, pEnd);
  const people = new Set(week.filter((o) => o.customer_hash).map((o) => o.customer_hash as string));
  const newCustomers = [...people].filter((h) => isNew(h, start, end)).length;

  const src = new Map<string, { orders: number; fresh: Set<string> }>();
  for (const o of week) {
    const key = o.source || "";
    const row = src.get(key) ?? { orders: 0, fresh: new Set<string>() };
    row.orders++;
    if (o.customer_hash && isNew(o.customer_hash, start, end)) row.fresh.add(o.customer_hash);
    src.set(key, row);
  }
  const bySource = [...src.entries()]
    .map(([source, r]) => ({
      source, orders: r.orders, newCustomers: r.fresh.size,
      label: SOURCE_NAMES[source] || (source ? source.replace(/-/g, " ") : "Unknown"),
    }))
    .sort((a, b) => b.orders - a.orders || a.label.localeCompare(b.label));

  const qty = new Map<string, number>();
  week.forEach((o) => (o.items ?? []).forEach((l) => qty.set(l.name, (qty.get(l.name) ?? 0) + l.qty)));
  const top = [...qty.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
    .map(([name, q]) => ({ name, qty: q }));

  return {
    orders: week.length, sales: sales(week), newCustomers,
    returningCustomers: people.size - newCustomers,
    untracked: week.filter((o) => !o.customer_hash).length,
    bySource, top,
    prev: { orders: prevWeek.length, sales: sales(prevWeek), newCustomers: newIn(prevWeek, pStart, pEnd) },
    monthOrders: inRange(`${end.slice(0, 7)}-01`, end).length,
  };
}
/* ----------------------------------------------------------------------- */

const change = (now: number, before: number) => {
  if (!before) return now ? "new this week" : "";
  const p = Math.round(((now - before) / before) * 100);
  return p === 0 ? "same as last week" : `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% vs last week`;
};
const niceDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function emailHtml(w: Week, start: string, end: string, extra: { bonus?: string; ads?: string }) {
  const tile = (big: string, label: string, sub: string) => `
      <td style="width:50%;padding:12px 14px;border:1px solid #e3ded2;vertical-align:top">
        <div style="font-size:26px;font-weight:700;line-height:1.1">${big}</div>
        <div style="font-size:14px;color:#5d625f">${label}</div>
        ${sub ? `<div style="font-size:12px;color:#8a8f8b;margin-top:2px">${sub}</div>` : ""}
      </td>`;
  const rows = w.bySource.map((s) => `<tr>
      <td style="padding:6px 8px 6px 0;border-bottom:1px solid #eee">${esc(s.label)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${s.orders}</td>
      <td style="padding:6px 0 6px 8px;border-bottom:1px solid #eee;text-align:right">${s.newCustomers}</td></tr>`).join("");
  const top = w.top.map((t) => `<tr><td style="padding:3px 12px 3px 0;font-weight:700">${t.qty}×</td><td style="padding:3px 0">${esc(t.name)}</td></tr>`).join("");
  const note = (s: string) => `<p style="font-size:15px;line-height:1.5;margin:16px 0 0;padding:10px 12px;background:#faf3e3;border-left:4px solid #E4A72E">${s}</p>`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1E1C">
    <div style="background:#14532b;color:#F4F1E8;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#E4A72E;font-weight:700">Your week · ${niceDay(start)} to ${niceDay(end)}</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">Lily's website orders</div>
    </div>
    <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:20px">
      <table style="border-collapse:collapse;width:100%">
        <tr>${tile(String(w.orders), "orders", change(w.orders, w.prev.orders))}${tile(money(w.sales), "food sales", change(w.sales, w.prev.sales))}</tr>
        <tr>${tile(String(w.newCustomers), "new customers", change(w.newCustomers, w.prev.newCustomers))}${tile(String(w.returningCustomers), "came back", "ordered before")}</tr>
      </table>
      ${w.orders ? `
      <p style="margin:20px 0 6px;font-weight:700">Where they came from</p>
      <table style="border-collapse:collapse;width:100%;font-size:15px">
        <tr style="color:#5d625f;font-size:13px"><td style="padding:0 8px 4px 0">Source</td><td style="padding:0 8px 4px;text-align:right">Orders</td><td style="padding:0 0 4px 8px;text-align:right">New</td></tr>
        ${rows}
      </table>
      <p style="margin:20px 0 6px;font-weight:700">Best sellers</p>
      <table style="border-collapse:collapse;font-size:15px">${top}</table>` : `
      <p style="margin:18px 0 0;font-size:15px">No website orders this week.</p>`}
      ${extra.ads ? note(extra.ads) : ""}
      ${extra.bonus ? note(extra.bonus) : ""}
      <p style="font-size:12px;color:#888;margin:20px 0 0;line-height:1.5">Website orders only, straight from your order system. Sales are food before tax, tips and delivery.<br>
        Lily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903</p>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value")
    .in("key", ["resend_api_key", "notify_email", "notify_from", "weekly_report_to", "weekly_report_cc",
      "weekly_report_enabled", "weekly_report_baseline", "weekly_report_last_week", "ads_spend_week"]);
  if (cfgErr) return json({ error: "config read failed" }, 503);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if ((cfg.weekly_report_enabled ?? "false").trim() !== "true") return json({ ok: true, note: "weekly report switched off" });
  const apiKey = Deno.env.get("RESEND_API_KEY") || cfg.resend_api_key || "";
  const to = (cfg.weekly_report_to || cfg.notify_email || "").trim();
  if (!apiKey || !to) return json({ ok: true, note: "email not configured" });

  const { start, end } = lastWeek(flDate(new Date().toISOString()));
  // claim the week before sending: one conditional update, so of two calls at
  // the same moment only one moves it forward (dates compare as text)
  const prevClaim = cfg.weekly_report_last_week ?? "";
  const { data: claimed } = await db.from("app_config").update({ value: start })
    .eq("key", "weekly_report_last_week").lt("value", start).select("key");
  if (!claimed?.length) return json({ ok: true, note: "already sent", week: start });
  const release = () => db.from("app_config").update({ value: prevClaim }).eq("key", "weekly_report_last_week").eq("value", start);

  const { data: rows, error } = await db.from("orders")
    .select("created_at,status,subtotal_cents,discount_cents,customer_hash,source,items")
    .eq("demo", false).not("code", "like", "TEST-%")
    .gte("created_at", new Date(Date.now() - 400 * 86400000).toISOString());
  if (error) { await release(); return json({ error: "orders read failed" }, 503); }
  const w = summarize((rows ?? []) as Ord[], start, end);

  const extra: { bonus?: string; ads?: string } = {};
  const baseline = Number(cfg.weekly_report_baseline);
  if (Number.isFinite(baseline) && baseline > 0) {
    const over = Math.max(0, w.monthOrders - baseline);
    extra.bonus = `<b>${w.monthOrders}</b> website orders so far this month (${baseline} included in the monthly fee${over ? `, <b>${over}</b> above` : ""}).`;
  }
  const [adsDay, adsDollars] = String(cfg.ads_spend_week ?? "").split(":");
  const ads = w.bySource.find((s) => s.source === "google-ads");
  if (adsDay === start && Number(adsDollars) > 0) {
    const spent = Number(adsDollars);
    const n = ads?.newCustomers ?? 0;
    extra.ads = `Google Ads: <b>$${spent.toFixed(2)}</b> spent, <b>${n}</b> new customer${n === 1 ? "" : "s"}${n ? ` (<b>$${(spent / n).toFixed(2)}</b> each)` : ""}.`;
  }

  const cc = String(cfg.weekly_report_cc ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.notify_from || "Lily's Orders <orders@lilysmediterraneanfresh.com>",
      to: [to], ...(cc.length ? { cc } : {}),
      subject: `Lily's week: ${w.orders} orders · ${money(w.sales)} · ${w.newCustomers} new customer${w.newCustomers === 1 ? "" : "s"}`,
      html: emailHtml(w, start, end, extra),
      text: `Lily's website, ${start} to ${end}: ${w.orders} orders, ${money(w.sales)} food sales, ${w.newCustomers} new customers, ${w.returningCustomers} came back.\n` +
        w.bySource.map((s) => `${s.label}: ${s.orders} orders, ${s.newCustomers} new`).join("\n"),
    }),
  });
  if (!resp.ok) {
    await release();
    console.error("weekly report send failed:", resp.status, await resp.text().catch(() => ""));
    return json({ error: "send failed" }, 502);
  }
  return json({ ok: true, week: start });
});
