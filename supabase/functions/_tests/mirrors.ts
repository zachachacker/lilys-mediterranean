/* Verbatim mirrors of the pure functions inside the Edge Functions.
 *
 * The deployed handlers call `Deno.serve(...)` at module scope, so importing
 * them directly would start a server. Instead each function below is a
 * BYTE-FOR-BYTE copy of the original, and `drift_test.ts` re-reads the real
 * source files and asserts these copies still match. If someone edits the
 * original without updating this file, the drift test fails loudly.
 *
 * Every export cites the file and line range it was copied from.
 */

/* ── stripe-webhook/index.ts:6 ────────────────────────────────────────── */
export const enc = new TextEncoder();

/* ── stripe-webhook/index.ts:8-13 — Uint8Array variant ────────────────── */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

/* ── stripe-webhook/index.ts:15-16 ────────────────────────────────────── */
export const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/* ── stripe-webhook/index.ts:18-29 ────────────────────────────────────── */
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  // header format: t=169...,v1=abc,v1=def — MULTIPLE v1 entries during secret rotation
  const pairs = header.split(",").map((kv) => kv.split("=") as [string, string]);
  const t = pairs.find(([k]) => k === "t")?.[1];
  const v1s = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || v1s.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const expected = enc.encode(hex(mac));
  return v1s.some((v) => timingSafeEqualBytes(expected, enc.encode(v)));
}

/* ── square-webhook/index.ts:11-18 — string variant.
      Also byte-identical to kitchen-api/index.ts:14-21. ─────────────────── */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i];
  return out === 0;
}

/* ── square-webhook/index.ts:20-30 ────────────────────────────────────── */
export async function expectedSquareSignature(
  key: string,
  notificationUrl: string,
  body: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(notificationUrl + body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/* ── kitchen-api/index.ts:25-31 ───────────────────────────────────────── */
export const ALLOWED_FROM: Record<string, string[]> = {
  paid: ["making"],                   // undo "start making"
  making: ["paid", "ready", "done"],  // advance, undo "ready", or recall a bumped ticket
  ready: ["making", "done"],          // advance, or undo "picked up"
  done: ["ready"],
  canceled: ["paid", "making", "ready"],
};

/* ── create-checkout/index.ts:29-36 — prefix param added for TEST- marking
      of closed-day test orders (2026-07-28) ──────────────────────────────── */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // no 0/O/1/I/L
export function makeCode(len = 4, prefix = "LM"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${prefix}-${s}`;
}

/* ── create-checkout — closed-day test bypass (2026-07-28, B-4 revision) ────
   Faithful TRANSCRIPTIONS. The secret is typed into the notes box as
   "#test:<value>" (POST body only — B-4): extractTestToken mirrors the
   notes-parse exactly (notesRaw arrives already .trim().slice(0,500));
   decideTestOrder mirrors the decision; hoursGateRefuses the gate.
   timingSafeEqualStr is byte-identical to the helper create-checkout
   carries (same family as kitchen-api:14-21 / square-webhook:11-18).      */
export function extractTestToken(notesRaw: string): { token: string; notes: string | null } {
  const testMatch = notesRaw.match(/^#test:(\S+)\s*/);
  const testTokenProvided = testMatch ? testMatch[1] : "";
  const notes = (testMatch ? notesRaw.slice(testMatch[0].length).trim() : notesRaw) || null;
  return { token: testTokenProvided, notes };
}

export function decideTestOrder(opts: { demo: boolean; cfgToken: string; provided: string }): boolean {
  const testOrderToken = (opts.cfgToken ?? "").trim();
  return !opts.demo && testOrderToken.length > 0 && opts.provided.length > 0 &&
    timingSafeEqualStr(opts.provided, testOrderToken);
}

export function hoursGateRefuses(opts: { demo: boolean; testOrder: boolean; open: boolean }): boolean {
  return !opts.demo && !opts.testOrder && !opts.open;
}

/* ── escaping variants ────────────────────────────────────────────────── */

/** order.js:18 — 3-char. Does NOT escape quotes. */
export const escOrder = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** chat.js:14 — 3-char, no String() coercion. Does NOT escape quotes. */
export const escChat = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** kitchen.js:41 — 5-char. The only variant that escapes both quote styles. */
export const escKitchen = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** notify-order/index.ts:11 — 3-char. Does NOT escape quotes. */
export const escNotify = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** daily-summary/index.ts:10 — 3-char. Does NOT escape quotes. */
export const escDaily = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** kitchen.js:42 */
export const telHref = (s: unknown) => "tel:" + String(s ?? "").replace(/[^+\d]/g, "");

/* ── create-checkout/index.ts:50-65 ───────────────────────────────────────
   Faithful TRANSCRIPTION (not a byte-copy — the original is inline in the
   request handler). Returns the first rejection, or the normalised fields.
   Order of checks matches the original exactly.                          */
export type CartLine = { id: string; qty: number; opts?: unknown };
export type ValidationResult =
  | { ok: true; name: string; phone: string; notes: string | null; items: CartLine[] }
  | { ok: false; status: number; error: string };

export function validateCheckoutBody(body: {
  items?: CartLine[];
  name?: string;
  phone?: string;
  notes?: string;
}): ValidationResult {
  const name = (body.name ?? "").trim().slice(0, 80);
  const phone = (body.phone ?? "").trim().slice(0, 25);
  const notes = (body.notes ?? "").trim().slice(0, 500) || null;
  const items = Array.isArray(body.items) ? body.items : [];

  if (name.length < 2) return { ok: false, status: 400, error: "Please tell us your name for pickup." };
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, status: 400, error: "Please enter a valid phone number." };
  if (items.length === 0) return { ok: false, status: 400, error: "Your cart looks empty." };
  if (items.length > 40) return { ok: false, status: 400, error: "That's a lot of different dishes! Please call us for orders this size." };
  for (const line of items) {
    if (typeof line.id !== "string" || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 20) {
      return { ok: false, status: 400, error: "Invalid cart contents." };
    }
    if (line.opts !== undefined &&
      (!Array.isArray(line.opts) || line.opts.length > 20 || line.opts.some((o) => typeof o !== "string"))) {
      return { ok: false, status: 400, error: "Invalid cart contents." };
    }
  }
  const optsOf = (l: CartLine) => (Array.isArray(l.opts) ? l.opts as string[] : []);
  const keys = items.map((l) => lineKey(l.id, optsOf(l)));
  if (new Set(keys).size !== keys.length) return { ok: false, status: 400, error: "Duplicate cart lines." };

  return { ok: true, name, phone, notes, items };
}

/* ── create-checkout/index.ts:79-116 ──────────────────────────────────────
   Faithful TRANSCRIPTION of the provider-selection / demo-mode decision,
   post readiness-gate fix (M-1/M-2, 2026-07-28): squareReady now requires
   all THREE Square values (token, location, webhook signature key), and a
   NAMED but not-fully-configured provider refuses with 503 BEFORE demo is
   computed. `refused503` covers all three refusal branches.              */
export type ProviderDecision = {
  provider: "" | "square" | "stripe";
  demo: boolean;
  refused503: boolean;
  status: "paid" | "pending" | "n/a — request refused";
};

export function decideProvider(opts: {
  wanted: string;
  squareToken: string;
  squareLocation: string;
  squareSigKey: string;
  stripeKey: string;
}): ProviderDecision {
  const { squareToken, squareLocation, squareSigKey, stripeKey } = opts;
  const wanted = (opts.wanted || "").trim().toLowerCase();
  const squareReady = Boolean(squareToken && squareLocation && squareSigKey);
  const refused503 = (wanted === "square" && !squareReady) ||
    (wanted === "stripe" && !stripeKey) ||
    (wanted !== "" && wanted !== "square" && wanted !== "stripe");
  if (refused503) {
    return { provider: "", demo: false, refused503, status: "n/a — request refused" };
  }
  const provider = wanted === "square" && squareReady
    ? "square"
    : wanted === "stripe" && stripeKey
    ? "stripe"
    : squareReady
    ? "square"
    : stripeKey
    ? "stripe"
    : "";
  const demo = !provider;
  return {
    provider: provider as ProviderDecision["provider"],
    demo,
    refused503,
    status: demo ? "paid" : "pending",
  };
}

/* ── create-checkout/index.ts — promotions engine ─────────────────────── */
export type Promo = {
  id: string; kind: string; label: string;
  item_id?: string | null; buy_qty?: number | null; free_qty?: number | null;
  percent?: number | null; min_subtotal_cents?: number | null;
  item_ids?: string[] | null; categories?: string[] | null;
  days?: number[] | null; start_min?: number | null; end_min?: number | null;
};
export type PLine = { id: string; qty: number; unit_cents: number; base_cents?: number; category?: string };

// whether a promotion's weekly schedule covers this moment (Florida day 0=Sun,
// minutes after midnight). No days = every day; no window = all day.
export function promoRunsAt(p: Promo, day: number, minute: number): boolean {
  if (Array.isArray(p.days) && p.days.length && !p.days.includes(day)) return false;
  if (p.start_min == null || p.end_min == null) return true;
  return minute >= p.start_min && minute < p.end_min;
}

export function floridaNow(): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    minute: (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10),
  };
}

export function applyPromotions(lines: PLine[], promos: Promo[]) {
  const subtotal = lines.reduce((s, l) => s + l.unit_cents * l.qty, 0);
  const applied: { id: string; label: string; cents: number }[] = [];
  let discount = 0;

  for (const p of promos.filter((x) => x.kind === "bogo")) {
    const buy = Math.floor(Number(p.buy_qty ?? 0));
    const free = Math.floor(Number(p.free_qty ?? 0));
    if (!p.item_id || buy <= 0 || free <= 0 || free > buy) continue;
    // one dish can sit on several lines (different add-ons): count them
    // together, and the free one is the dish alone at its cheapest, never
    // its add-ons
    const its = lines.filter((l) => l.id === p.item_id);
    if (!its.length) continue;
    const qty = its.reduce((s, l) => s + l.qty, 0);
    const unit = Math.min(...its.map((l) => l.base_cents ?? l.unit_cents));
    const sets = Math.floor(qty / buy);
    const cents = sets * free * unit;
    if (cents > 0) { discount += cents; applied.push({ id: p.id, label: p.label, cents }); }
  }

  for (const p of promos.filter((x) => x.kind === "percent_items")) {
    const pct = Number(p.percent ?? 0);
    if (!(pct > 0 && pct <= 100)) continue;
    const ids = p.item_ids ?? [];
    const cats = p.categories ?? [];
    const base = lines
      .filter((l) => ids.includes(l.id) || (l.category !== undefined && cats.includes(l.category)))
      .reduce((s, l) => s + (l.base_cents ?? l.unit_cents) * l.qty, 0);
    const cents = Math.round((base * pct) / 100);
    if (cents > 0) { discount += cents; applied.push({ id: p.id, label: p.label, cents }); }
  }

  const afterItem = Math.max(0, subtotal - discount);
  for (const p of promos.filter((x) => x.kind === "percent_over")) {
    const pct = Number(p.percent ?? 0);
    const min = Number(p.min_subtotal_cents ?? 0);
    if (!(pct > 0 && pct <= 100) || afterItem < min || afterItem <= 0) continue;
    const cents = Math.round((afterItem * pct) / 100);
    if (cents > 0) { discount += cents; applied.push({ id: p.id, label: p.label, cents }); }
  }

  discount = Math.min(discount, subtotal);
  return { subtotal, discount, applied };
}

/* ── create-checkout/index.ts — delivery helpers (2026-10-07, repriced 10-10) */
export const LILYS_LAT = 28.09175;
export const LILYS_LON = -80.56608;
export const DELIVERY_MAX_MILES = 5;
export const DELIVERY_MIN_CENTS = 1500;
export const TIP_MAX_CENTS = 10000;

export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(a));
}

export function deliveryFeeCents(miles: number): number | null {
  if (!Number.isFinite(miles) || miles < 0 || miles > DELIVERY_MAX_MILES) return null;
  if (miles <= 2) return 0;
  return 1000;
}

export function parseTipCents(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > TIP_MAX_CENTS) return null;
  return n;
}

/* ── create-checkout/index.ts — analytics helpers (2026-10-08) ─────────── */
export function normSource(raw: unknown, max = 40): string | null {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, max);
  return s || null;
}

export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; // +1 US prefix
}

export async function customerHash(salt: string, phone: string): Promise<string | null> {
  const digits = phoneDigits(phone);
  if (!salt || digits.length < 10) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${digits}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── create-checkout/index.ts — add-ons (2026-10-10) ──────────────────── */
export type AddonOpt = { id: string; group_id: string; name: string; price_cents: number; sort: number; available: boolean };
export type AddonGroup = { id: string; max_select: number; sort: number; min_select?: number; label?: string };
export type AddonPick = { id: string; name: string; cents: number };

export function lineKey(id: string, opts: string[]): string {
  return opts.length ? `${id}|${[...opts].sort().join(",")}` : id;
}

export function priceAddons(
  itemGroups: string[], optIds: string[], opts: Map<string, AddonOpt>, groups: Map<string, AddonGroup>,
): { ok: true; addons: AddonPick[]; cents: number } | { ok: false; error: string } {
  if (new Set(optIds).size !== optIds.length) return { ok: false, error: "Invalid cart contents." };
  const perGroup = new Map<string, number>();
  const picked: AddonOpt[] = [];
  for (const id of optIds) {
    const o = opts.get(id);
    if (!o || !itemGroups.includes(o.group_id)) return { ok: false, error: "Invalid cart contents." };
    const g = groups.get(o.group_id);
    const n = (perGroup.get(o.group_id) ?? 0) + 1;
    if (!g || n > g.max_select) return { ok: false, error: "Invalid cart contents." };
    if (!o.available) return { ok: false, error: `Sorry, ${o.name} is sold out today. Please remove it and try again.` };
    perGroup.set(o.group_id, n);
    picked.push(o);
  }
  // required choices (lunch specials: fries or rice, which sauce): min_select
  for (const gid of itemGroups) {
    const g = groups.get(gid);
    if (g && (g.min_select ?? 0) > (perGroup.get(gid) ?? 0)) {
      return { ok: false, error: `Please choose: ${g.label ?? "an option"}.` };
    }
  }
  // kitchen reading order: group order, then the option's place in its group
  picked.sort((a, b) => (groups.get(a.group_id)!.sort - groups.get(b.group_id)!.sort) || (a.sort - b.sort));
  const addons = picked.map((o) => ({ id: o.id, name: o.name, cents: o.price_cents }));
  return { ok: true, addons, cents: addons.reduce((s, a) => s + a.cents, 0) };
}

/* ── kitchen-api/index.ts — stock states (2026-10-10) ─────────────────── */
export const OUT_FOREVER = "2999-01-01T00:00:00.000Z";
export type StockState = "on" | "today" | "off" | "hidden";

export function stockState(outUntil: string | null | undefined, hidden: boolean | null | undefined, now: number): StockState {
  if (hidden) return "hidden";
  const t = outUntil ? Date.parse(outUntil) : NaN;
  if (!Number.isFinite(t) || t <= now) return "on";
  return t >= Date.parse("2900-01-01T00:00:00Z") ? "off" : "today";
}

// The next 4:00am on Florida's clock, as a UTC instant. 4am rather than
// midnight so a late close never brings an item back mid-service.
export function nextFloridaMorning(now: Date): string {
  const wall = (d: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  };
  // Florida minus UTC at an instant, in ms (negative)
  const offsetAt = (d: Date) => {
    const w = wall(d);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(d.getTime() / 1000) * 1000;
  };
  const w = wall(now);
  const target = Date.UTC(w.y, w.mo - 1, w.d, 4, 0, 0) + (w.h >= 4 ? 86400000 : 0);
  // offset measured at the target itself, so a DST change overnight still lands on 4am
  const guess = target - offsetAt(now);
  return new Date(target - offsetAt(new Date(guess))).toISOString();
}

export function stockPatch(state: StockState, now: Date): { out_until: string | null; hidden: boolean } {
  if (state === "hidden") return { out_until: null, hidden: true };
  if (state === "off") return { out_until: OUT_FOREVER, hidden: false };
  if (state === "today") return { out_until: nextFloridaMorning(now), hidden: false };
  return { out_until: null, hidden: false };
}

/* ── create-checkout/index.ts — lunch specials (2026-10-16) ───────────── */
export const LUNCH_CATEGORY = "Lunch Specials";
export function lunchRunsAt(day: number, minute: number): boolean {
  return day >= 1 && day <= 5 && minute >= 11 * 60 && minute < 15 * 60;
}

/* ── sodas/index.ts — lunch soda list (2026-10-16) ─────────────────────── */
const GROUP = "lunch-soda";
// names as typed or ticked -> a clean, de-duplicated list with stable ids
export function cleanSodas(raw: unknown): { id: string; name: string }[] | null {
  if (!Array.isArray(raw) || raw.length > 15) return null;
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") return null;
    const name = r.replace(/[<>"]/g, "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > 40) return null;
    const slug = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ id: `${GROUP}-${slug}`.slice(0, 60), name });
  }
  return out;
}

/* ── kitchen-api/index.ts — pause online ordering (2026-10-15) ──────────── */
export type PauseMode = "20" | "60" | "today" | "on" | "resume";

export function pauseUntil(mode: PauseMode, now: Date): string {
  if (mode === "resume") return "";
  if (mode === "on") return OUT_FOREVER;
  if (mode === "today") return nextFloridaMorning(now);
  return new Date(now.getTime() + Number(mode) * 60_000).toISOString();
}

/* ── create-checkout/index.ts — discount links (2026-10-10) ───────────── */
export const TOKEN_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;
export const PAID_STATUSES = ["paid", "making", "ready", "done"];

export function codeDiscountCents(afterPromos: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 50 || afterPromos <= 0) return 0;
  return Math.round((afterPromos * percent) / 100);
}

export const CLUB_CAP_DEFAULT_CENTS = 750;
export function clubCapCents(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : CLUB_CAP_DEFAULT_CENTS;
}

export function loyaltyDue(paidOrders: number, usedRewards: number, every: number): boolean {
  if (!Number.isInteger(every) || every < 2) return false;
  return Math.floor(paidOrders / every) > usedRewards;
}

/* ── apply/index.ts: job applications from careers.html (2026-10-16).
      The block between the markers is byte-identical to the source;
      apply_test.ts asserts it. ───────────────────────────────────────── */
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


/* ── catering-enquiry/index.ts:28-89: validateCatering, verbatim ── */
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

/* ── weekly-report/index.ts:26-146: the whole pure block, verbatim ── */
/* ---- pure helpers (mirrored in _tests/mirrors.ts) ---------------------- */
export const COUNTED = ["paid", "making", "ready", "done"];
export const SOURCE_NAMES: Record<string, string> = {
  "google-ads": "Google Ads", google: "Google (listing, Maps & search)", direct: "Direct / typed in", instagram: "Instagram",
  facebook: "Facebook", tiktok: "TikTok", yelp: "Yelp", tripadvisor: "TripAdvisor", bing: "Bing",
  duckduckgo: "DuckDuckGo", sticker: "Bag sticker", ubereats: "Uber Eats", doordash: "DoorDash",
  gbp: "Google listing", "gbp-order": "Google \"Order online\" button", "old-site": "Old website",
  qr: "QR code", flyer: "Flyer", email: "Lily's Club email", club: "Lily's Club welcome",
  referral: "Friend's link", "ready-email": "Order-ready email", "review-email": "Review email", receipt: "Receipt QR",
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
  total_cents?: number; tip_cents?: number | null; review_asked_at?: string | null; fulfilment?: string | null;
};
export type Highlights = {
  takenCents: number; tipsCents: number; tipsDays: number; dishes: number; biggestCents: number;
  bestDay: { day: string; orders: number; cents: number } | null; reviewsAsked: number;
  deliveryOrders: number; deliveryDays: number;
};
export type Week = {
  orders: number; sales: number; newCustomers: number; returningCustomers: number; untracked: number;
  bySource: { source: string; label: string; orders: number; newCustomers: number }[];
  top: { name: string; qty: number }[];
  prev: { orders: number; sales: number; newCustomers: number };
  monthOrders: number;
  repeatCustomers: number; // ordered 2+ times inside the range (the all-time report's "came back")
  firstDay: string | null; // earliest counted order ever, for the all-time report
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
      label: SOURCE_NAMES[source] || (source ? source.replace(/-/g, " ") : "Unknown (before tracking)"),
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
    repeatCustomers: [...people].filter((h) => week.filter((o) => o.customer_hash === h).length > 1).length,
    firstDay: counted.reduce<string | null>((m, o) => (!m || o.day < m ? o.day : m), null),
  };
}

const daysIn = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1;

// the first (all-time) report leads with these: every one a real total. Tips
// and delivery went live partway through, so each is counted over its own days
// (since = the day it went live; app_config tips_live_since / delivery_live_since)
export function highlights(all: Ord[], start: string, end: string, since: { tips?: string; delivery?: string } = {}): Highlights {
  const os = all.filter((o) => COUNTED.includes(o.status))
    .map((o) => ({ ...o, day: flDate(o.created_at) })).filter((o) => o.day >= start && o.day <= end);
  const byDay = new Map<string, { orders: number; cents: number }>();
  for (const o of os) {
    const d = byDay.get(o.day) ?? { orders: 0, cents: 0 };
    d.orders++; d.cents += o.total_cents ?? 0; byDay.set(o.day, d);
  }
  const best = [...byDay.entries()].sort((a, b) => b[1].orders - a[1].orders || b[1].cents - a[1].cents)[0];
  const tipsFrom = since.tips && since.tips > start ? since.tips : start;
  const delFrom = since.delivery && since.delivery > start ? since.delivery : start;
  return {
    takenCents: os.reduce((s, o) => s + (o.total_cents ?? 0), 0),
    tipsCents: os.filter((o) => o.day >= tipsFrom).reduce((s, o) => s + (o.tip_cents ?? 0), 0),
    tipsDays: tipsFrom <= end ? daysIn(tipsFrom, end) : 0,
    deliveryOrders: os.filter((o) => o.day >= delFrom && o.fulfilment === "delivery").length,
    deliveryDays: delFrom <= end ? daysIn(delFrom, end) : 0,
    dishes: os.reduce((s, o) => s + (o.items ?? []).reduce((t, l) => t + l.qty, 0), 0),
    biggestCents: os.reduce((m, o) => Math.max(m, o.total_cents ?? 0), 0),
    bestDay: best ? { day: best[0], ...best[1] } : null,
    // stamped 1970-01-01 = looked at but not asked (ask-review); only real asks count
    reviewsAsked: os.filter((o) => o.review_asked_at && o.review_asked_at > "1971").length,
  };
}

/* ── manage-api/index.ts — offer validation + offer emails (2026-10-10) ─ */
export type PromoRow = {
  kind: string; label: string; active?: boolean;
  item_id: string | null; buy_qty: number | null; free_qty: number | null;
  percent: number | null; min_subtotal_cents: number | null;
  item_ids: string[] | null; categories: string[] | null;
  days: number[] | null; start_min: number | null; end_min: number | null;
  starts_at: string | null; ends_at: string | null;
};

export const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

// Turns whatever the page sent into a clean row, or a message Kareem can act on.
export function validatePromo(
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
export const SITE = "https://lilysmediterraneanfresh.com";
export const FN = "https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1";
export const SEND_GAP_DAYS = 3;
export const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const hm = (m: number) => { const h = Math.floor(m / 60), mi = m % 60; return `${h % 12 || 12}${mi ? ":" + String(mi).padStart(2, "0") : ""}${h < 12 || h === 24 ? "am" : "pm"}`; };
export const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function whenText(p: { days: number[] | null; start_min: number | null; end_min: number | null; ends_at: string | null }): string {
  const days = p.days?.length && p.days.length < 7
    ? (p.days.join() === "1,2,3,4,5" ? "Monday to Friday" : p.days.join() === "0,6" ? "weekends" : p.days.map((d) => DAY[d]).join(", "))
    : "every day";
  const time = p.start_min != null && p.end_min != null ? `, ${hm(p.start_min)} to ${hm(p.end_min)}` : "";
  const until = p.ends_at
    ? `, until ${new Date(p.ends_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" })}` : "";
  return `Online orders, ${days}${time}${until}.`;
}

export function offerEmail(p: Record<string, unknown>, token: string) {
  // body link on our own domain; the header's one-click address must accept a POST
  const unsub = `${SITE}/club.html#u=${token}`;
  const oneClick = `${FN}/deals?u=${token}`;
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
  return { html, text, unsub, oneClick };
}

// database row -> what the page shows (bogo: paid count, not group size)
export function toPage<T extends { kind: string; buy_qty: number | null; free_qty: number | null }>(r: T): T {
  return r.kind === "bogo" && r.buy_qty != null && r.free_qty != null ? { ...r, buy_qty: r.buy_qty - r.free_qty } : r;
}
