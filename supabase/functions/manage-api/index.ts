// Offers manager API (2026-10-10) — Kareem creates and runs his own promotions
// from manage.html. Access: x-manager-key must match app_config.manager_key.
// This writes the rules create-checkout charges by, so every field is checked
// here, strictly, whatever the page already checked. Percent is capped at 50.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-manager-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// byte-identical to kitchen-api/index.ts
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i];
  return out === 0;
}

const COLS = "id,kind,label,active,item_id,buy_qty,free_qty,percent,min_subtotal_cents,item_ids,categories,days,start_min,end_min,starts_at,ends_at,created_at";

type PromoRow = {
  kind: string; label: string; active?: boolean;
  item_id: string | null; buy_qty: number | null; free_qty: number | null;
  percent: number | null; min_subtotal_cents: number | null;
  item_ids: string[] | null; categories: string[] | null;
  days: number[] | null; start_min: number | null; end_min: number | null;
  starts_at: string | null; ends_at: string | null;
};

const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

// Turns whatever the page sent into a clean row, or a message Kareem can act on.
function validatePromo(
  p: Record<string, unknown>, itemIds: Set<string>, categories: Set<string>,
): { ok: true; row: PromoRow } | { ok: false; error: string } {
  const kind = String(p.kind ?? "");
  if (!["percent_items", "bogo", "percent_over"].includes(kind)) return { ok: false, error: "Pick a type of offer." };
  const label = String(p.label ?? "").replace(/\s+/g, " ").trim();
  if (label.length < 3 || label.length > 60) return { ok: false, error: "Give the offer a name of 3 to 60 characters." };

  const row: PromoRow = {
    kind, label, item_id: null, buy_qty: null, free_qty: null, percent: null, min_subtotal_cents: null,
    item_ids: null, categories: null, days: null, start_min: null, end_min: null, starts_at: null, ends_at: null,
  };

  if (kind === "percent_items" || kind === "percent_over") {
    if (!isInt(p.percent, 1, 50)) return { ok: false, error: "The discount must be a whole number from 1% to 50%." };
    row.percent = p.percent as number;
  }
  if (kind === "percent_items") {
    const ids = Array.isArray(p.item_ids) ? [...new Set(p.item_ids.map(String))] : [];
    const cats = Array.isArray(p.categories) ? [...new Set(p.categories.map(String))] : [];
    if (ids.some((i) => !itemIds.has(i))) return { ok: false, error: "One of the chosen dishes isn't on the menu any more." };
    if (cats.some((c) => !categories.has(c))) return { ok: false, error: "One of the chosen menu sections doesn't exist any more." };
    if (!ids.length && !cats.length) return { ok: false, error: "Choose at least one dish or menu section." };
    row.item_ids = ids.length ? ids : null;
    row.categories = cats.length ? cats : null;
  }
  if (kind === "bogo") {
    // The page speaks "buy N, get M free" (N paid). The engine's buy_qty is the
    // whole group, paid + free ("buy 1 get 1" = groups of 2, 1 free), so it is
    // converted here and back in toPage(). Storing N as-is would make every unit free.
    const id = String(p.item_id ?? "");
    if (!itemIds.has(id)) return { ok: false, error: "Choose the dish for this offer." };
    if (!isInt(p.buy_qty, 1, 10)) return { ok: false, error: "\"Buy\" must be a number from 1 to 10." };
    if (!isInt(p.free_qty, 1, p.buy_qty as number)) return { ok: false, error: "\"Free\" can't be more than \"buy\"." };
    row.item_id = id; row.buy_qty = (p.buy_qty as number) + (p.free_qty as number); row.free_qty = p.free_qty as number;
  }
  if (kind === "percent_over") {
    if (!isInt(p.min_subtotal_cents, 0, 100000)) return { ok: false, error: "Enter the minimum order in dollars." };
    row.min_subtotal_cents = p.min_subtotal_cents as number;
  }

  if (p.days != null) {
    if (!Array.isArray(p.days) || p.days.some((d) => !isInt(d, 0, 6))) return { ok: false, error: "Those days don't look right." };
    const days = [...new Set(p.days as number[])].sort();
    row.days = days.length && days.length < 7 ? days : null; // every day = no restriction
  }
  const hasStart = p.start_min != null, hasEnd = p.end_min != null;
  if (hasStart || hasEnd) {
    if (!isInt(p.start_min, 0, 1440) || !isInt(p.end_min, 0, 1440) || (p.start_min as number) >= (p.end_min as number)) {
      return { ok: false, error: "The start time must be before the end time." };
    }
    row.start_min = p.start_min as number; row.end_min = p.end_min as number;
  }
  for (const k of ["starts_at", "ends_at"] as const) {
    if (p[k] == null || p[k] === "") continue;
    const t = Date.parse(String(p[k]));
    if (!Number.isFinite(t)) return { ok: false, error: "That date doesn't look right." };
    row[k] = new Date(t).toISOString();
  }
  if (row.starts_at && row.ends_at && Date.parse(row.starts_at) >= Date.parse(row.ends_at)) {
    return { ok: false, error: "The first day must be before the last day." };
  }
  if (typeof p.active === "boolean") row.active = p.active;
  return { ok: true, row };
}

/* ── "Email this offer" (2026-10-10) ──────────────────────────────────────
   Sends an offer to the special-offers list: only people who ticked the box at
   checkout or confirmed a signup, never the receipt emails Stripe collected.
   Every email carries the restaurant's address and a one-click unsubscribe
   (CAN-SPAM; Gmail/Yahoo bulk rules). At most one offer email every 3 days, so
   a double tap or an eager week can't burn the list. */
const SITE = "https://lilysmediterraneanfresh.com";
const FN = "https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1";
const SEND_GAP_DAYS = 3;
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (m: number) => { const h = Math.floor(m / 60), mi = m % 60; return `${h % 12 || 12}${mi ? ":" + String(mi).padStart(2, "0") : ""}${h < 12 || h === 24 ? "am" : "pm"}`; };
const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function whenText(p: { days: number[] | null; start_min: number | null; end_min: number | null; ends_at: string | null }): string {
  const days = p.days?.length && p.days.length < 7
    ? (p.days.join() === "1,2,3,4,5" ? "Monday to Friday" : p.days.join() === "0,6" ? "weekends" : p.days.map((d) => DAY[d]).join(", "))
    : "every day";
  const time = p.start_min != null && p.end_min != null ? `, ${hm(p.start_min)} to ${hm(p.end_min)}` : "";
  const until = p.ends_at
    ? `, until ${new Date(p.ends_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" })}` : "";
  return `Online orders, ${days}${time}${until}.`;
}

function offerEmail(p: Record<string, unknown>, token: string) {
  const unsub = `${FN}/deals?u=${token}`;
  const order = `${SITE}/order.html?src=email&utm_campaign=${encodeURIComponent(String(p.id))}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1A1E1C">
    <div style="background:#14532b;color:#F4F1E8;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#E4A72E;font-weight:700">Members only</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">Lily's Mediterranean</div></div>
    <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:24px">
      <h1 style="font-size:26px;line-height:1.15;margin:0 0 10px;color:#B4472B">${escH(String(p.label))}</h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${escH(whenText(p as never))} It comes off automatically at checkout, no code needed.</p>
      <p style="margin:0 0 22px"><a href="${order}" style="display:inline-block;background:#B4472B;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 26px;border-radius:99px">Order now</a></p>
      <p style="font-size:12px;color:#888;margin:0;line-height:1.5">You're getting this because you're a Lily's Club member.
        <a href="${unsub}" style="color:#888">Unsubscribe</a><br>Lily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903 · (321) 312-4444</p>
    </div></div>`;
  const text = `${p.label}
${whenText(p as never)} Comes off automatically at checkout.
Order: ${order}

Unsubscribe: ${unsub}
Lily's Mediterranean Fresh Grill, 2 5th Ave STE C, Indialantic, FL 32903`;
  return { html, text, unsub };
}

// database row -> what the page shows (bogo: paid count, not group size)
function toPage<T extends { kind: string; buy_qty: number | null; free_qty: number | null }>(r: T): T {
  return r.kind === "bogo" && r.buy_qty != null && r.free_qty != null ? { ...r, buy_qty: r.buy_qty - r.free_qty } : r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: keyRow, error: keyErr } = await db.from("app_config").select("value").eq("key", "manager_key").maybeSingle();
  if (keyErr) {
    console.error("manager_key read failed:", keyErr.message);
    return json({ error: "Temporarily unavailable" }, 503);
  }
  const expected = keyRow?.value ?? "";
  const provided = req.headers.get("x-manager-key") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    console.warn("manage-api: wrong key attempt");
    await new Promise((r) => setTimeout(r, 1000));
    return json({ error: "Wrong manager key" }, 401);
  }

  let body: { action?: string; id?: unknown; active?: unknown; promo?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const menu = async () => {
    const { data, error } = await db.from("menu_items").select("id,name,category").eq("orderable", true).order("category").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  try {
    if (body.action === "list") {
      const [{ data, error }, items] = await Promise.all([
        db.from("promotions").select(COLS).order("created_at"), menu(),
      ]);
      if (error) throw new Error(error.message);
      const [{ count: subs }, { data: last }] = await Promise.all([
        db.from("subscribers").select("email", { count: "exact", head: true }).not("confirmed_at", "is", null).is("unsubscribed_at", null),
        db.from("deal_sends").select("sent_at,subject,recipients").order("sent_at", { ascending: false }).limit(1),
      ]);
      return json({ promos: (data ?? []).map(toPage), menu: items, subscribers: subs ?? 0, last_send: last?.[0] ?? null, now: new Date().toISOString() });
    }

    if (body.action === "save") {
      const items = await menu();
      const v = validatePromo(body.promo ?? {}, new Set(items.map((i) => i.id)), new Set(items.map((i) => i.category)));
      if (!v.ok) return json({ error: v.error }, 400);
      const id = typeof body.promo?.id === "string" ? body.promo.id : "";
      if (id) {
        const { data, error } = await db.from("promotions").update(v.row).eq("id", id).select(COLS);
        if (error) throw new Error(error.message);
        if (!(data ?? []).length) return json({ error: "That offer no longer exists." }, 404);
        return json({ ok: true, promo: toPage(data[0]) });
      }
      const { data, error } = await db.from("promotions")
        .insert({ id: `p-${crypto.randomUUID().slice(0, 8)}`, active: false, ...v.row }).select(COLS).single();
      if (error) throw new Error(error.message);
      return json({ ok: true, promo: toPage(data) });
    }

    if (body.action === "set_active") {
      if (typeof body.id !== "string" || typeof body.active !== "boolean") return json({ error: "Bad request" }, 400);
      const { data, error } = await db.from("promotions").update({ active: body.active }).eq("id", body.id).select("id,active");
      if (error) throw new Error(error.message);
      if (!(data ?? []).length) return json({ error: "That offer no longer exists." }, 404);
      return json({ ok: true, id: body.id, active: data[0].active });
    }

    if (body.action === "email_offer") {
      if (typeof body.id !== "string") return json({ error: "Bad request" }, 400);
      const { data: p, error: pe } = await db.from("promotions").select(COLS).eq("id", body.id).maybeSingle();
      if (pe) throw new Error(pe.message);
      if (!p) return json({ error: "That offer no longer exists." }, 404);
      if (!p.active) return json({ error: "Switch the offer on first, so customers actually get it when they order." }, 400);
      const { data: last } = await db.from("deal_sends").select("sent_at").order("sent_at", { ascending: false }).limit(1);
      const lastAt = last?.[0] ? Date.parse(last[0].sent_at) : 0;
      if (Date.now() - lastAt < SEND_GAP_DAYS * 86400_000) {
        const next = new Date(lastAt + SEND_GAP_DAYS * 86400_000)
          .toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });
        return json({ error: `You sent an offer email recently. To keep people subscribed, the next one can go out on ${next}.` }, 400);
      }
      const { data: subs, error: se } = await db.from("subscribers").select("email,token")
        .not("confirmed_at", "is", null).is("unsubscribed_at", null);
      if (se) throw new Error(se.message);
      if (!subs?.length) return json({ error: "Lily's Club has no members yet. Customers join by ticking the box when they order." }, 400);
      const { data: k } = await db.from("app_config").select("value").eq("key", "resend_api_key").maybeSingle();
      const apiKey = Deno.env.get("RESEND_API_KEY") || k?.value || "";
      if (!apiKey) return json({ error: "Email isn't set up yet." }, 503);
      // record first, so a retry after a timeout can't double-send
      const { error: re } = await db.from("deal_sends").insert({ promo_id: p.id, subject: p.label, recipients: subs.length });
      if (re) throw new Error(re.message);
      let sent = 0;
      for (let i = 0; i < subs.length; i += 100) {
        const batch = subs.slice(i, i + 100).map((s: { email: string; token: string }) => {
          const m = offerEmail(p, s.token);
          return {
            from: "Lily's Club <club@lilysmediterraneanfresh.com>", to: [s.email], subject: p.label,
            html: m.html, text: m.text,
            headers: { "List-Unsubscribe": `<${m.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          };
        });
        const r = await fetch("https://api.resend.com/emails/batch", {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(batch),
        });
        if (!r.ok) { console.error("offer batch failed:", r.status, await r.text().catch(() => "")); break; }
        sent += batch.length;
      }
      if (sent < subs.length) await db.from("deal_sends").update({ recipients: sent }).eq("promo_id", p.id).order("sent_at", { ascending: false }).limit(1);
      return sent ? json({ ok: true, sent }) : json({ error: "The email didn't go out. Please try again later." }, 502);
    }

    if (body.action === "delete") {
      if (typeof body.id !== "string") return json({ error: "Bad request" }, 400);
      const { error } = await db.from("promotions").delete().eq("id", body.id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }
  } catch (ex) {
    console.error("manage-api failed:", ex instanceof Error ? ex.message : ex);
    return json({ error: "Temporarily unavailable" }, 503);
  }
  return json({ error: "Unknown action" }, 400);
});
