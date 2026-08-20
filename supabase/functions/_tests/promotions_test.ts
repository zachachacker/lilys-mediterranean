/* Promotions are the only thing in this system that changes what a customer is
 * charged, so every rule gets a case — including the ones that must NOT fire.
 */
import { assertEquals } from "jsr:@std/assert@1";
import { applyPromotions, type Promo, type PLine } from "./mirrors.ts";

const BOGO = (o: Partial<Promo> = {}): Promo => ({
  id: "p1", kind: "bogo", label: "Buy one get one free — Hummus",
  item_id: "hummus", buy_qty: 2, free_qty: 1, ...o,
});
const PCT = (o: Partial<Promo> = {}): Promo => ({
  id: "p2", kind: "percent_over", label: "10% off over $70",
  percent: 10, min_subtotal_cents: 7000, ...o,
});
const hummus = (qty: number): PLine => ({ id: "hummus", qty, unit_cents: 975 });

Deno.test("no promotions = no discount", () => {
  const r = applyPromotions([hummus(3)], []);
  assertEquals(r.discount, 0);
  assertEquals(r.subtotal, 2925);
});

Deno.test("bogo: 2 gives 1 free, 1 gives nothing", () => {
  assertEquals(applyPromotions([hummus(1)], [BOGO()]).discount, 0);
  assertEquals(applyPromotions([hummus(2)], [BOGO()]).discount, 975);
});

Deno.test("bogo: 3 still only one free — it does not round up", () => {
  assertEquals(applyPromotions([hummus(3)], [BOGO()]).discount, 975);
});

Deno.test("bogo: 4 gives two free", () => {
  assertEquals(applyPromotions([hummus(4)], [BOGO()]).discount, 1950);
});

Deno.test("bogo: an item that is not in the cart never discounts", () => {
  const r = applyPromotions([{ id: "falafel", qty: 9, unit_cents: 770 }], [BOGO()]);
  assertEquals(r.discount, 0);
});

Deno.test("percent_over: below the threshold does not fire", () => {
  const lines = [{ id: "x", qty: 1, unit_cents: 6999 }];
  assertEquals(applyPromotions(lines, [PCT()]).discount, 0);
});

Deno.test("percent_over: exactly the threshold fires", () => {
  const lines = [{ id: "x", qty: 1, unit_cents: 7000 }];
  assertEquals(applyPromotions(lines, [PCT()]).discount, 700);
});

Deno.test("percent_over is measured AFTER item discounts, not before", () => {
  // 8 hummus = $78.00. BOGO frees 4 => $39.00, which is under $70, so the
  // percentage must NOT fire. Judging it on the pre-discount figure would
  // hand out a discount on money the customer never spends.
  const r = applyPromotions([hummus(8)], [BOGO(), PCT()]);
  assertEquals(r.subtotal, 7800);
  assertEquals(r.discount, 3900);
  assertEquals(r.applied.length, 1);
});

Deno.test("both can apply when the total still clears the threshold", () => {
  const lines = [hummus(2), { id: "platter", qty: 3, unit_cents: 2600 }];
  const r = applyPromotions(lines, [BOGO(), PCT()]);
  assertEquals(r.subtotal, 9750);          // 1950 + 7800
  // bogo 975, remainder 8775 >= 7000 so 10% = 878 (rounded)
  assertEquals(r.discount, 975 + 878);
  assertEquals(r.applied.length, 2);
});

Deno.test("discount can never exceed the subtotal", () => {
  const huge = PCT({ percent: 100, min_subtotal_cents: 0 });
  const r = applyPromotions([hummus(2)], [BOGO(), huge]);
  assertEquals(r.discount, r.subtotal);
});

Deno.test("malformed promotions are ignored, not crashed on", () => {
  const bad: Promo[] = [
    BOGO({ buy_qty: 0 }),
    BOGO({ free_qty: 5, buy_qty: 2 }),            // free > buy
    BOGO({ item_id: null }),
    PCT({ percent: 0 }),
    PCT({ percent: 150 }),
    { id: "z", kind: "nonsense", label: "?" },
  ];
  assertEquals(applyPromotions([hummus(4)], bad).discount, 0);
});

Deno.test("an empty cart cannot produce a discount", () => {
  assertEquals(applyPromotions([], [BOGO(), PCT({ min_subtotal_cents: 0 })]).discount, 0);
});
