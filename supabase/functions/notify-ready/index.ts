// "Your order is ready" email to the customer (2026-10-10). Fired by the
// orders_notify_ready trigger when the kitchen taps Ready (pg_net -> here).
// The address is the one Stripe collected at payment (stripe-webhook stores
// it). Sends once per order: ready_notified_at is claimed BEFORE sending, so a
// Ready -> undo -> Ready on the tablet, or a retried trigger, never sends twice.
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DIRECTIONS = "https://www.google.com/maps/dir/?api=1&destination=2+5th+Ave+STE+C+Indialantic+FL+32903";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const orderId = String(body.order_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return json({ error: "order_id required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config, error: cfgErr } = await db.from("app_config").select("key,value")
    .in("key", ["resend_api_key", "customer_from", "ready_email_enabled"]);
  if (cfgErr) return json({ error: "config read failed" }, 503);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if ((cfg.ready_email_enabled ?? "true").trim() === "false") return json({ ok: true, note: "ready emails switched off" });
  const apiKey = Deno.env.get("RESEND_API_KEY") || cfg.resend_api_key || "";
  if (!apiKey) return json({ ok: true, note: "email not configured" });

  // claim first: only the call that flips ready_notified_at from null sends
  const { data: claimed, error } = await db.from("orders")
    .update({ ready_notified_at: new Date().toISOString() })
    .eq("id", orderId).eq("status", "ready").is("ready_notified_at", null).not("customer_email", "is", null)
    .select("code,customer_name,customer_email,fulfilment,delivery_address,items,created_at");
  if (error) return json({ error: "lookup failed" }, 500);
  const o = (claimed ?? [])[0];
  if (!o) return json({ ok: true, note: "nothing to send" });
  // a ticket bumped to Ready hours later (forgotten, then cleared) shouldn't email anyone
  if (Date.now() - new Date(o.created_at).getTime() > 6 * 3600_000) return json({ ok: true, note: "stale order" });

  const first = String(o.customer_name ?? "").trim().split(/\s+/)[0] || "there";
  const delivery = o.fulfilment === "delivery";
  const items = (o.items ?? []).map((l: { qty: number; name: string; addons?: { name: string }[] }) =>
    `<li style="margin:2px 0">${l.qty} × ${esc(l.name)}${l.addons?.length ? ` <span style="color:#777">+ ${l.addons.map((a) => esc(a.name)).join(", ")}</span>` : ""}</li>`).join("");
  const headline = delivery ? "Your order is on its way" : "Your order is ready";
  const line = delivery
    ? `It has just left the kitchen and is heading to ${esc(o.delivery_address ?? "you")}.`
    : `It's ready for pickup now at <b>2 5th Ave STE C, Indialantic</b>. Show this code at the counter:`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1A1E1C">
    <div style="background:#14532b;color:#F4F1E8;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:22px;font-weight:700">Lily's Mediterranean</div>
    </div>
    <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:22px">
      <h1 style="font-size:22px;margin:0 0 8px">${headline}, ${esc(first)}!</h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 14px">${line}</p>
      <div style="font-family:Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:2px;background:#F4F1E8;border-radius:8px;padding:12px;text-align:center;margin:0 0 16px">${esc(o.code)}</div>
      <ul style="padding-left:18px;font-size:15px;margin:0 0 16px">${items}</ul>
      ${delivery ? "" : `<p style="margin:0 0 6px"><a href="${DIRECTIONS}" style="color:#1F5A5F">Directions</a></p>`}
      <p style="font-size:14px;color:#555;margin:14px 0 0">Questions? Call us at <a href="tel:+13213124444" style="color:#1F5A5F">(321) 312-4444</a>. Replies to this email aren't read.</p>
    </div>
  </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.customer_from || "Lily's Mediterranean <orders@lilysmediterraneanfresh.com>",
      to: [o.customer_email],
      subject: delivery ? `Your Lily's order ${o.code} is on its way` : `Your Lily's order ${o.code} is ready for pickup`,
      html,
      text: `${headline}, ${first}! ${delivery ? "It's on its way." : `Pickup at 2 5th Ave STE C, Indialantic. Your code: ${o.code}.`} Questions? (321) 312-4444`,
    }),
  });
  if (!resp.ok) {
    // release the claim so a later Ready tap can try again
    await db.from("orders").update({ ready_notified_at: null }).eq("id", orderId);
    console.error("ready email failed:", resp.status, await resp.text().catch(() => ""));
    return json({ error: "send failed" }, 502);
  }
  return json({ ok: true, sent: o.code });
});
