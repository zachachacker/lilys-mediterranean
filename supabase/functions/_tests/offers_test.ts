/* Offers Kareem makes himself (2026-10-10): scheduled days/hours, % off
 * chosen dishes or sections, and the manager API's validation, which is the
 * only gate between a typo and every order that follows. */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { applyPromotions, type PLine, type Promo, promoRunsAt, validatePromo } from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const unexport = (s: string) => s.replace(/^export /gm, "");

Deno.test("drift: promotions block in create-checkout is byte-identical to the mirror", async () => {
  const c = await Deno.readTextFile(new URL("create-checkout/index.ts", root));
  const m = await Deno.readTextFile(new URL("_tests/mirrors.ts", root));
  assertEquals(unexport(between(m, "export type Promo = {", "/* ── create-checkout/index.ts — delivery")).trim(),
    between(c, "type Promo = {", "/* ── discount links").trim());
  // the schedule filter is applied to what the database returns
  assert(c.includes("promos = ((data ?? []) as Promo[]).filter((p) => promoRunsAt(p, fl.day, fl.minute));"));
});

Deno.test("drift: manage-api validation is byte-identical to the mirror", async () => {
  const g = await Deno.readTextFile(new URL("manage-api/index.ts", root));
  const m = await Deno.readTextFile(new URL("_tests/mirrors.ts", root));
  assertEquals(unexport(m.slice(m.indexOf("export type PromoRow = {"))).trim(), between(g, "type PromoRow = {", "Deno.serve(").trim());
  assert(g.includes('if (!expected || !timingSafeEqual(provided, expected)) {'));
});

const LUNCH: Promo = {
  id: "l", kind: "percent_items", label: "Lunch: 15% off bowls", percent: 15,
  categories: ["Lily's Bowls"], days: [1, 2, 3, 4, 5], start_min: 660, end_min: 900,
};

Deno.test("schedule: weekdays 11am to 3pm", () => {
  assert(promoRunsAt(LUNCH, 1, 660));          // Mon 11:00 starts
  assert(promoRunsAt(LUNCH, 5, 899));          // Fri 14:59
  assert(!promoRunsAt(LUNCH, 5, 900));         // 15:00 has ended
  assert(!promoRunsAt(LUNCH, 1, 659));         // 10:59 not yet
  assert(!promoRunsAt(LUNCH, 6, 700));         // Saturday
  assert(!promoRunsAt(LUNCH, 0, 700));         // Sunday
});

Deno.test("schedule: no days and no window means always", () => {
  const p: Promo = { id: "a", kind: "bogo", label: "x" };
  assert(promoRunsAt(p, 0, 0) && promoRunsAt(p, 6, 1439));
  assert(promoRunsAt({ ...p, days: [] }, 3, 600));
});

const bowl = (qty: number, extra = 0): PLine => ({ id: "falafel-bowl", qty, unit_cents: 1545 + extra, base_cents: 1545, category: "Lily's Bowls" });
const wrap: PLine = { id: "falafel-wrap", qty: 1, unit_cents: 1235, base_cents: 1235, category: "Wraps, Gyros & Subs" };

Deno.test("percent_items: only matching dishes, dish price only (never add-ons)", () => {
  const r = applyPromotions([bowl(2, 430), wrap], [LUNCH]);
  assertEquals(r.subtotal, 2 * 1975 + 1235);
  assertEquals(r.discount, Math.round(2 * 1545 * 0.15));
});

Deno.test("percent_items: a chosen dish counts as well as a chosen section", () => {
  const p: Promo = { id: "d", kind: "percent_items", label: "x", percent: 10, item_ids: ["falafel-wrap"] };
  assertEquals(applyPromotions([bowl(1), wrap], [p]).discount, 124);
  assertEquals(applyPromotions([bowl(1)], [p]).discount, 0);
});

Deno.test("percent_items comes before percent_over, which judges what's left", () => {
  const over: Promo = { id: "o", kind: "percent_over", label: "10% over $30", percent: 10, min_subtotal_cents: 3000 };
  // 2 bowls 3090 -> 15% = 464 off -> 2626 left, under $30, so no 10%
  const r = applyPromotions([bowl(2)], [LUNCH, over]);
  assertEquals(r.discount, 464);
  assertEquals(r.applied.length, 1);
});

/* ---- manager validation ---- */
const ITEMS = new Set(["falafel-bowl", "falafel-wrap", "hummus"]);
const CATS = new Set(["Lily's Bowls", "Mezze & Starters"]);
const ok = (p: Record<string, unknown>) => validatePromo(p, ITEMS, CATS);

Deno.test("manager: a full lunch special is accepted and normalised", () => {
  const r = ok({ kind: "percent_items", label: "  Lunch   special ", percent: 15, categories: ["Lily's Bowls"],
    days: [5, 1, 1, 2, 3, 4], start_min: 660, end_min: 900 });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.row.label, "Lunch special");
    assertEquals(r.row.days, [1, 2, 3, 4, 5]);
    assertEquals(r.row.item_ids, null);
  }
});

Deno.test("manager: every day collapses to no restriction", () => {
  const r = ok({ kind: "percent_over", label: "Big order", percent: 10, min_subtotal_cents: 7000, days: [0, 1, 2, 3, 4, 5, 6] });
  assert(r.ok && r.row.days === null);
});

Deno.test("manager: refuses money mistakes", () => {
  const base = { kind: "percent_items", label: "Deal", categories: ["Lily's Bowls"] };
  assertEquals(ok({ ...base, percent: 0 }).ok, false);
  assertEquals(ok({ ...base, percent: 51 }).ok, false);     // 50% cap
  assertEquals(ok({ ...base, percent: 15.5 }).ok, false);
  assertEquals(ok({ ...base, percent: "15" }).ok, false);
  assertEquals(ok({ kind: "percent_items", label: "Deal", percent: 10 }).ok, false); // nothing chosen
  assertEquals(ok({ ...base, percent: 10, item_ids: ["lobster"] }).ok, false);
  assertEquals(ok({ ...base, percent: 10, categories: ["Steaks"] }).ok, false);
  assertEquals(ok({ kind: "bogo", label: "BOGO", item_id: "hummus", buy_qty: 1, free_qty: 2 }).ok, false);
  assertEquals(ok({ kind: "bogo", label: "BOGO", item_id: "nope", buy_qty: 1, free_qty: 1 }).ok, false);
  assertEquals(ok({ kind: "percent_over", label: "Big", percent: 10, min_subtotal_cents: -1 }).ok, false);
  assertEquals(ok({ kind: "free_money", label: "Hmm", percent: 10 }).ok, false);
  assertEquals(ok({ kind: "bogo", label: "x", item_id: "hummus", buy_qty: 1, free_qty: 1 }).ok, false); // name too short
});

Deno.test("manager: refuses broken schedules and dates", () => {
  const base = { kind: "bogo", label: "BOGO hummus", item_id: "hummus", buy_qty: 1, free_qty: 1 };
  assert(ok(base).ok);
  assertEquals(ok({ ...base, start_min: 900, end_min: 660 }).ok, false);
  assertEquals(ok({ ...base, start_min: 660 }).ok, false);
  assertEquals(ok({ ...base, days: [7] }).ok, false);
  assertEquals(ok({ ...base, starts_at: "2026-10-20T00:00:00Z", ends_at: "2026-10-19T00:00:00Z" }).ok, false);
  assertEquals(ok({ ...base, starts_at: "not a date" }).ok, false);
});
