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
export const DELIVERY_MAX_MILES = 7;
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
  return 1500;
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
export type AddonGroup = { id: string; max_select: number; sort: number };
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

/* ── create-checkout/index.ts — discount links (2026-10-10) ───────────── */
export const TOKEN_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;
export const PAID_STATUSES = ["paid", "making", "ready", "done"];

export function codeDiscountCents(afterPromos: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 50 || afterPromos <= 0) return 0;
  return Math.round((afterPromos * percent) / 100);
}

/* ── manage-api/index.ts — offer validation (2026-10-10) ─────────────── */
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
    const id = String(p.item_id ?? "");
    if (!itemIds.has(id)) return { ok: false, error: "Choose the dish for this offer." };
    if (!isInt(p.buy_qty, 1, 10)) return { ok: false, error: "\"Buy\" must be a number from 1 to 10." };
    if (!isInt(p.free_qty, 1, p.buy_qty as number)) return { ok: false, error: "\"Free\" can't be more than \"buy\"." };
    row.item_id = id; row.buy_qty = p.buy_qty as number; row.free_qty = p.free_qty as number;
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
