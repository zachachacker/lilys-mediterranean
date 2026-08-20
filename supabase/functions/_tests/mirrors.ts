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
export type CartLine = { id: string; qty: number };
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
  }
  const ids = items.map((l) => l.id);
  if (new Set(ids).size !== ids.length) return { ok: false, status: 400, error: "Duplicate cart lines." };

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
};
export type PLine = { id: string; qty: number; unit_cents: number };

export function applyPromotions(lines: PLine[], promos: Promo[]) {
  const subtotal = lines.reduce((s, l) => s + l.unit_cents * l.qty, 0);
  const applied: { id: string; label: string; cents: number }[] = [];
  let discount = 0;

  for (const p of promos.filter((x) => x.kind === "bogo")) {
    const buy = Math.floor(Number(p.buy_qty ?? 0));
    const free = Math.floor(Number(p.free_qty ?? 0));
    if (!p.item_id || buy <= 0 || free <= 0 || free > buy) continue;
    const line = lines.find((l) => l.id === p.item_id);
    if (!line) continue;
    const sets = Math.floor(line.qty / buy);
    const cents = sets * free * line.unit_cents;
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
