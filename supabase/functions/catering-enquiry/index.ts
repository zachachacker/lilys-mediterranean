// Catering enquiries from catering.html (2026-10-19). Before this the page only
// had a phone number and a mailto link, and catering went to HoneyCart, ezCater
// and Sauce. One office order is a whole group of new customers at once.
// verify_jwt stays ON: the page calls this with the anon key.
//   POST {name, phone, email?, company?, event_date, guests, fulfilment,
//         notes?, source?, website (honeypot), test?}
// Stores the row first (catering_enquiries, service role only), then emails
// Kareem (app_config notify_email) with a Call button and, if they gave an
// email, thanks the customer. A failed email never loses the enquiry.
// test: true is honoured only when the name starts with "TEST ": the row is
// stored but no emails go out. Same pattern as apply/index.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const MAX_PER_DAY = 3; // a 4th enquiry from the same connection within 24h is refused
const PHONE = "(321) 312-4444";

// --- validateCatering: mirrored byte-for-byte in _tests/mirrors.ts ---
export const FULFILMENT = ["Pickup", "Delivery", "Not sure yet"];
export const CATERING_LIMITS = { name: 80, email: 254, company: 100, notes: 1500, guestsMin: 5, guestsMax: 2000 };
export type Enquiry = {
  name: string; phone: string; email: string | null; company: string | null; event_date: string;
  guests: number; fulfilment: string; notes: string | null; source: string | null;
};
export type CateringChecked = { ok: true; row: Enquiry; test: boolean } | { ok: false; error: string; bot?: true };

// today is the Florida date as YYYY-MM-DD. Errors are shown to the customer as-is.
export function validateCatering(b: Record<string, unknown>, today: string): CateringChecked {
  if (String(b.website ?? "").trim() !== "") return { ok: false, error: "bot", bot: true };
  const str = (v: unknown) => (typeof v === "string" ? v : "").trim();
  const L = CATERING_LIMITS;

  const name = str(b.name).replace(/\s+/g, " ");
  if (name.length < 2) return { ok: false, error: "Please tell us your name." };
  if (name.length > L.name) return { ok: false, error: `Please keep your name to ${L.name} characters or fewer.` };

  let digits = str(b.phone).replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { ok: false, error: "Please enter a 10-digit US phone number." };
  const phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;

  const email = str(b.email).toLowerCase();
  if (email && (email.length > L.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: "That email address doesn't look right. You can also leave it blank." };
  }
  const company = str(b.company);
  if (company.length > L.company) return { ok: false, error: `Please keep the company name to ${L.company} characters or fewer.` };

  const ed = str(b.event_date);
  const t = Date.parse(`${ed}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ed) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== ed) {
    return { ok: false, error: "Please pick the date of your event." };
  }
  const day = (offset: number) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  if (ed < today || ed > day(366)) return { ok: false, error: "Please pick a date from today to a year ahead." };

  const guests = typeof b.guests === "number" ? b.guests : Number(str(b.guests));
  if (!Number.isInteger(guests) || guests < L.guestsMin || guests > L.guestsMax) {
    return { ok: false, error: `Please enter how many people, from ${L.guestsMin} to ${L.guestsMax}.` };
  }

  const fulfilment = str(b.fulfilment);
  if (!FULFILMENT.includes(fulfilment)) return { ok: false, error: "Please choose pickup or delivery." };

  const notes = str(b.notes);
  if (notes.length > L.notes) return { ok: false, error: `Please keep your message to ${L.notes} characters or fewer.` };

  const source = str(b.source).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);

  return {
    ok: true,
    test: b.test === true && name.startsWith("TEST "),
    row: {
      name, phone, email: email || null, company: company || null, event_date: ed, guests, fulfilment,
      notes: notes || null, source: source || null,
    },
  };
}
// --- end validateCatering ---

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const prettyDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

async function sendEmail(apiKey: string, payload: Record<string, unknown>, what: string): Promise<boolean> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error(`${what} email failed:`, r.status, await r.text().catch(() => ""));
    return r.ok;
  } catch (e) {
    console.error(`${what} email failed:`, e);
    return false;
  }
}

function kareemEmail(e: Enquiry, id: number, today: string) {
  const first = e.name.split(" ")[0];
  const tel = `tel:+1${e.phone.replace(/\D/g, "")}`;
  const when = prettyDate(e.event_date);
  const days = Math.round((Date.parse(`${e.event_date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const flags = [
    new Date(`${e.event_date}T12:00:00Z`).getUTCDay() === 3 ? "This is a Wednesday, when you're closed." : "",
    days <= 2 ? `Short notice: ${days === 0 ? "today" : days === 1 ? "tomorrow" : "in 2 days"}.` : "",
  ].filter(Boolean);
  const rows: [string, string][] = [
    ["Name", esc(e.name)],
    ["Phone", `<a href="${tel}" style="color:#1F5A5F;font-weight:700">${esc(e.phone)}</a>`],
    ["Email", e.email ? `<a href="mailto:${esc(e.email)}" style="color:#1F5A5F">${esc(e.email)}</a>` : "Not given"],
    ["Company", e.company ? esc(e.company) : "Not given"],
    ["Date", esc(when)],
    ["People", String(e.guests)],
    ["Pickup or delivery", esc(e.fulfilment)],
    ["Message", e.notes ? esc(e.notes) : "Not given"],
  ];
  const table = rows.map(([k, v]) => `<tr>
      <td style="padding:9px 12px 9px 0;vertical-align:top;color:#666;font-size:13px;white-space:nowrap;border-top:1px solid #eee">${k}</td>
      <td style="padding:9px 0;vertical-align:top;font-size:15px;line-height:1.45;white-space:pre-wrap;border-top:1px solid #eee">${v}</td></tr>`).join("");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A1E1C">
    <div style="background:#14532b;color:#F4F1E8;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#E4A72E;font-weight:700">Catering enquiry</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${e.guests} people · ${esc(when)}</div></div>
    <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:20px 22px">
      ${flags.map((f) => `<p style="margin:0 0 12px;padding:10px 12px;background:#faf3e3;border-left:4px solid #E4A72E;font-size:15px">${esc(f)}</p>`).join("")}
      <p style="margin:0 0 16px"><a href="${tel}" style="display:inline-block;background:#B4472B;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 24px;border-radius:99px">Call ${esc(first)}</a></p>
      <table style="width:100%;border-collapse:collapse">${table}</table>
      <p style="font-size:12px;color:#888;margin:16px 0 0">Sent from the catering page (enquiry #${id}).${e.email ? " Reply to this email to answer them." : ""}</p>
    </div></div>`;
  const text = [
    `Catering enquiry: ${e.guests} people, ${when}`, ...flags, "",
    `Name: ${e.name}`, `Phone: ${e.phone}`, `Email: ${e.email ?? "Not given"}`, `Company: ${e.company ?? "Not given"}`,
    `Pickup or delivery: ${e.fulfilment}`, "", `Message: ${e.notes ?? "Not given"}`,
  ].join("\n");
  return { subject: `Catering enquiry: ${e.guests} people, ${when} (${first})`, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const raw = await req.text();
  if (raw.length > 10_000) return json({ error: "That's a bit long. Please shorten your message and try again." }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Something went wrong. Please try again." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Something went wrong. Please try again." }, 400);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const v = validateCatering(body, today);
  // a bot gets the same answer as a person, so it learns nothing
  if (!v.ok) return v.bot ? json({ ok: true }) : json({ error: v.error }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config } = await db.from("app_config").select("key,value")
    .in("key", ["resend_api_key", "notify_email", "customer_hash_salt"]);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

  // the IP itself is never stored, only a salted hash for the daily limit
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  const ipHash = ip ? await sha256(`ip:${cfg.customer_hash_salt ?? ""}:${ip}`) : null;
  if (ipHash) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count, error } = await db.from("catering_enquiries").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", since);
    if (!error && (count ?? 0) >= MAX_PER_DAY) {
      return json({ error: `We've already had a few enquiries from this connection today. Please call us on ${PHONE} instead.` }, 429);
    }
  }

  const { data: saved, error } = await db.from("catering_enquiries").insert({ ...v.row, ip_hash: ipHash }).select("id").single();
  if (error || !saved) {
    console.error("catering insert failed:", error);
    return json({ error: `We couldn't send your enquiry. Please try again in a moment, or call us on ${PHONE}.` }, 503);
  }
  if (v.test) return json({ ok: true, test: true });

  const e = v.row;
  const apiKey = Deno.env.get("RESEND_API_KEY") || cfg.resend_api_key || "";
  if (!apiKey || !cfg.notify_email) {
    console.error(`catering enquiry #${saved.id} stored but not emailed: email not configured`);
    return json({ ok: true });
  }
  const m = kareemEmail(e, saved.id, today);
  await sendEmail(apiKey, {
    from: "Lily's Website <orders@lilysmediterraneanfresh.com>",
    to: [cfg.notify_email],
    ...(e.email ? { reply_to: e.email } : {}),
    subject: m.subject, html: m.html, text: m.text,
  }, `catering #${saved.id} owner`);
  if (e.email) {
    const first = e.name.split(" ")[0];
    await sendEmail(apiKey, {
      from: "Lily's Mediterranean <orders@lilysmediterraneanfresh.com>",
      to: [e.email],
      subject: "We got your catering enquiry",
      text: `Hi ${first},

Thanks for thinking of Lily's for your event on ${prettyDate(e.event_date)} (${e.guests} people). Kareem has your enquiry and will call you to plan the menu and confirm the price.

In a hurry? Call us on ${PHONE}.

Lily's Mediterranean Fresh Grill
2 5th Ave STE C, Indialantic, FL 32903`,
    }, `catering #${saved.id} thank-you`);
  }
  return json({ ok: true });
});
