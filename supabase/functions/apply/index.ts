// Job applications from careers.html (2026-10-16, Kareem is hiring line cooks,
// prep cooks and cashiers/servers). verify_jwt stays ON: the page calls this
// with the anon key, like its other function calls.
//   POST {name, phone, email?, positions[], availability[], start_date?,
//         experience?, notes?, over_16, website (honeypot), test?}
// Stores the row first (job_applications, service role only), then emails
// Kareem (app_config notify_email) and, if they gave an email, thanks the
// applicant. A failed email never loses the application: it is logged.
// test: true is honoured only when the name starts with "TEST ": the row is
// stored but no emails go out, so the live form can be checked end to end.
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

const MAX_PER_DAY = 3; // a 4th application from the same connection within 24h is refused
const PHONE = "(321) 312-4444";

// --- validateApplication: mirrored byte-for-byte in _tests/mirrors.ts ---
export const POSITIONS = ["Line Cook", "Prep Cook", "Cashier / Server"];
// no Wednesday: the restaurant is closed that day
export const AVAILABILITY = ["Mon", "Tue", "Thu", "Fri", "Sat", "Sun", "Lunch (11-3)", "Evenings"];
export const LIMITS = { name: 80, email: 254, experience: 1500, notes: 1000 };
export type Application = {
  name: string; phone: string; email: string | null; positions: string[]; availability: string[];
  start_date: string | null; experience: string | null; notes: string | null; over_16: boolean;
};
export type Checked = { ok: true; row: Application; test: boolean } | { ok: false; error: string; bot?: true };

// today is the Florida date as YYYY-MM-DD. Errors are shown to the applicant as-is.
export function validateApplication(b: Record<string, unknown>, today: string): Checked {
  // people never see the honeypot field; bots fill in everything
  if (String(b.website ?? "").trim() !== "") return { ok: false, error: "bot", bot: true };
  const str = (v: unknown) => (typeof v === "string" ? v : "").trim();

  const name = str(b.name).replace(/\s+/g, " ");
  if (name.length < 2) return { ok: false, error: "Please tell us your full name." };
  if (name.length > LIMITS.name) return { ok: false, error: `Please keep your name to ${LIMITS.name} characters or fewer.` };

  let digits = str(b.phone).replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { ok: false, error: "Please enter a 10-digit US phone number." };
  const phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;

  const email = str(b.email).toLowerCase();
  if (email && (email.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: "That email address doesn't look right. You can also leave it blank." };
  }

  // only values from the list, deduplicated, in the list's order
  const pick = (v: unknown, allowed: string[]) =>
    Array.isArray(v) && v.length <= allowed.length * 2 && v.every((x) => allowed.includes(x as string))
      ? allowed.filter((a) => v.includes(a)) : null;
  const positions = pick(b.positions, POSITIONS);
  if (!positions) return { ok: false, error: "Please choose a job from the list." };
  if (!positions.length) return { ok: false, error: "Please choose at least one job." };
  const availability = pick(b.availability, AVAILABILITY);
  if (!availability) return { ok: false, error: "Please choose your availability from the list." };
  if (!availability.length) return { ok: false, error: "Please tell us at least one day or time you can work." };

  const sd = str(b.start_date);
  const day = (offset: number) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  if (sd) {
    const t = Date.parse(`${sd}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== sd) {
      return { ok: false, error: "That start date doesn't look right." };
    }
    if (sd < day(-1) || sd > day(366)) return { ok: false, error: "Please pick a start date within the next year." };
  }

  const experience = str(b.experience);
  if (experience.length > LIMITS.experience) {
    return { ok: false, error: `Please keep your experience to ${LIMITS.experience} characters or fewer.` };
  }
  const notes = str(b.notes);
  if (notes.length > LIMITS.notes) return { ok: false, error: `Please keep "anything else" to ${LIMITS.notes} characters or fewer.` };

  if (typeof b.over_16 !== "boolean") return { ok: false, error: "Please tell us if you're 16 or older." };

  return {
    ok: true,
    test: b.test === true && name.startsWith("TEST "),
    row: {
      name, phone, email: email || null, positions, availability, start_date: sd || null,
      experience: experience || null, notes: notes || null, over_16: b.over_16,
    },
  };
}
// --- end validateApplication ---

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

function kareemEmail(a: Application, id: number) {
  const parts = a.name.split(" ");
  const first = parts[0];
  const short = parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
  const tel = `tel:+1${a.phone.replace(/\D/g, "")}`;
  const start = a.start_date ? prettyDate(a.start_date) : "Not given";
  const rows: [string, string][] = [
    ["Name", esc(a.name)],
    ["Phone", `<a href="${tel}" style="color:#1F5A5F;font-weight:700">${esc(a.phone)}</a>`],
    ["Email", a.email ? `<a href="mailto:${esc(a.email)}" style="color:#1F5A5F">${esc(a.email)}</a>` : "Not given"],
    ["Job", esc(a.positions.join(", "))],
    ["Can work", esc(a.availability.join(", "))],
    ["Earliest start", esc(start)],
    ["16 or older", a.over_16 ? "Yes" : "<b style=\"color:#B4472B\">No</b>"],
    ["Experience", a.experience ? esc(a.experience) : "Not given"],
    ["Anything else", a.notes ? esc(a.notes) : "Not given"],
  ];
  const table = rows.map(([k, v]) => `<tr>
      <td style="padding:9px 12px 9px 0;vertical-align:top;color:#666;font-size:13px;white-space:nowrap;border-top:1px solid #eee">${k}</td>
      <td style="padding:9px 0;vertical-align:top;font-size:15px;line-height:1.45;white-space:pre-wrap;border-top:1px solid #eee">${v}</td></tr>`).join("");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A1E1C">
    <div style="background:#14532b;color:#F4F1E8;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#E4A72E;font-weight:700">Job application</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(a.name)}</div></div>
    <div style="border:1px solid #e3ded2;border-top:0;border-radius:0 0 10px 10px;padding:20px 22px">
      <p style="margin:0 0 16px"><a href="${tel}" style="display:inline-block;background:#B4472B;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 24px;border-radius:99px">Call ${esc(first)}</a></p>
      <table style="width:100%;border-collapse:collapse">${table}</table>
      <p style="font-size:12px;color:#888;margin:16px 0 0">Sent from the Join our team page on lilysmediterraneanfresh.com (application #${id}).${a.email ? " Reply to this email to answer them." : ""}</p>
    </div></div>`;
  const text = [
    `Job application: ${a.name}`, "",
    `Phone: ${a.phone}`, `Email: ${a.email ?? "Not given"}`, `Job: ${a.positions.join(", ")}`,
    `Can work: ${a.availability.join(", ")}`, `Earliest start: ${start}`, `16 or older: ${a.over_16 ? "Yes" : "No"}`,
    "", `Experience: ${a.experience ?? "Not given"}`, "", `Anything else: ${a.notes ?? "Not given"}`,
  ].join("\n");
  return { subject: `Job application: ${short} (${a.positions.join(", ")})`, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const raw = await req.text();
  if (raw.length > 20_000) return json({ error: "That's a bit long. Please shorten your answers and try again." }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Something went wrong. Please try again." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Something went wrong. Please try again." }, 400);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const v = validateApplication(body, today);
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
    const { count, error } = await db.from("job_applications").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", since);
    if (!error && (count ?? 0) >= MAX_PER_DAY) {
      return json({ error: `We've already had a few applications from this connection today. Please call us on ${PHONE} instead.` }, 429);
    }
  }

  const { data: saved, error } = await db.from("job_applications").insert({ ...v.row, ip_hash: ipHash }).select("id").single();
  if (error || !saved) {
    console.error("application insert failed:", error);
    return json({ error: `We couldn't save your application. Please try again in a moment, or call us on ${PHONE}.` }, 503);
  }
  if (v.test) return json({ ok: true, test: true });

  const a = v.row;
  const apiKey = Deno.env.get("RESEND_API_KEY") || cfg.resend_api_key || "";
  if (!apiKey || !cfg.notify_email) {
    console.error(`application #${saved.id} stored but not emailed: email not configured`);
    return json({ ok: true });
  }
  const m = kareemEmail(a, saved.id);
  await sendEmail(apiKey, {
    from: "Lily's Website <orders@lilysmediterraneanfresh.com>",
    to: [cfg.notify_email],
    ...(a.email ? { reply_to: a.email } : {}),
    subject: m.subject, html: m.html, text: m.text,
  }, `application #${saved.id} owner`);
  if (a.email) {
    const first = a.name.split(" ")[0];
    await sendEmail(apiKey, {
      from: "Lily's Mediterranean <orders@lilysmediterraneanfresh.com>",
      to: [a.email],
      subject: "Thanks for applying to Lily's",
      text: `Hi ${first},

Thanks for applying to work at Lily's Mediterranean Fresh Grill. Kareem has your application and will be in touch.

Questions? Call us on ${PHONE}.

Lily's Mediterranean Fresh Grill
2 5th Ave STE C, Indialantic, FL 32903`,
    }, `application #${saved.id} thank-you`);
  }
  return json({ ok: true });
});
