/* Lunch specials (Kareem's flyer, 2026-10-16): weekdays 11am to 3pm Florida,
 * pickup or dine-in only, required choices (fries or rice, which sauce), and
 * never combined with other offers. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { type AddonGroup, type AddonOpt, LUNCH_CATEGORY, lunchRunsAt, priceAddons } from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const src = () => Deno.readTextFile(new URL("create-checkout/index.ts", root));

const OPTS = new Map<string, AddonOpt>([
  ["lunch-fries", { id: "lunch-fries", group_id: "lunch-side", name: "Fries", price_cents: 0, sort: 0, available: true }],
  ["lunch-rice", { id: "lunch-rice", group_id: "lunch-side", name: "Rice", price_cents: 0, sort: 1, available: true }],
  ["lunch-garlic", { id: "lunch-garlic", group_id: "lunch-sauce", name: "Garlic sauce", price_cents: 0, sort: 0, available: true }],
  ["lunch-x-pita", { id: "lunch-x-pita", group_id: "lunch-extra", name: "Pita bread", price_cents: 100, sort: 2, available: true }],
]);
const GROUPS = new Map<string, AddonGroup>([
  ["lunch-side", { id: "lunch-side", max_select: 1, min_select: 1, sort: 6, label: "Fries or rice" }],
  ["lunch-sauce", { id: "lunch-sauce", max_select: 1, min_select: 1, sort: 7, label: "Your 2oz sauce" }],
  ["lunch-extra", { id: "lunch-extra", max_select: 10, min_select: 0, sort: 10, label: "Make it your way" }],
]);
const PLATE = ["lunch-side", "lunch-sauce", "lunch-extra"];

Deno.test("drift: lunch rules in create-checkout match the mirror", async () => {
  const s = await src();
  assertStringIncludes(s, `const LUNCH_CATEGORY = "Lunch Specials";`);
  assertStringIncludes(s, "return day >= 1 && day <= 5 && minute >= 11 * 60 && minute < 15 * 60;");
  assertStringIncludes(s, "if (g && (g.min_select ?? 0) > (perGroup.get(gid) ?? 0)) {");
  // pickup only, served only in the window, and kept out of every offer
  assertStringIncludes(s, `if (fulfilment === "delivery") {\n      return json({ error: "Lunch specials are pickup only.`);
  assertStringIncludes(s, "if (!demo && !testOrder && !lunchRunsAt(fl.day, fl.minute)) {");
  assertStringIncludes(s, "const promo = applyPromotions(lines.filter((l) => !isLunch(l.id))");
  assertStringIncludes(s, "const subtotal = promo.subtotal + lunchCents;");
  assertStringIncludes(s, "const offerable = () => Math.max(0, subtotal - lunchCents - discount);");
  assert(!s.includes("codeDiscountCents(subtotal - discount"), "a discount link still sees lunch lines");
  // a dish with required groups loads the group table even with no picks sent
  assertStringIncludes(s, "(menu ?? []).some((m: MenuRow) => (m.addon_groups ?? []).length)");
});

Deno.test("lunch window: weekdays 11:00 up to 15:00 only", () => {
  assertEquals(LUNCH_CATEGORY, "Lunch Specials");
  assert(lunchRunsAt(1, 11 * 60));
  assert(lunchRunsAt(5, 14 * 60 + 59));
  assert(!lunchRunsAt(5, 15 * 60));
  assert(!lunchRunsAt(3, 10 * 60 + 59));
  assert(!lunchRunsAt(0, 12 * 60)); // Sunday
  assert(!lunchRunsAt(6, 12 * 60)); // Saturday
});

Deno.test("required choices: a plate needs fries or rice AND a sauce", () => {
  const none = priceAddons(PLATE, [], OPTS, GROUPS);
  assertEquals(none, { ok: false, error: "Please choose: Fries or rice." });
  const half = priceAddons(PLATE, ["lunch-rice"], OPTS, GROUPS);
  assertEquals(half, { ok: false, error: "Please choose: Your 2oz sauce." });
  const ok = priceAddons(PLATE, ["lunch-rice", "lunch-garlic", "lunch-x-pita"], OPTS, GROUPS);
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.cents, 100);
});

Deno.test("required choices: still only one of each", () => {
  const two = priceAddons(PLATE, ["lunch-rice", "lunch-fries", "lunch-garlic"], OPTS, GROUPS);
  assertEquals(two.ok, false);
});

Deno.test("optional groups are untouched by the new rule", () => {
  const extraOnly = priceAddons(["lunch-extra"], [], OPTS, GROUPS);
  assert(extraOnly.ok);
});
