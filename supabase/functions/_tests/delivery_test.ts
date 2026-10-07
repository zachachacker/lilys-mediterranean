/* Delivery + tips (Kareem, 2026-10-07): free <=2 mi, $5 <=3.5 mi, $10 <=5 mi,
 * refused beyond; $15 food minimum; tips 0..$100, delivery only.
 * Drift cases pin the real source; behaviour cases pin the money rules. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  DELIVERY_MAX_MILES, DELIVERY_MIN_CENTS, LILYS_LAT, LILYS_LON, TIP_MAX_CENTS,
  deliveryFeeCents, milesBetween, parseTipCents,
} from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const src = () => Deno.readTextFile(new URL("create-checkout/index.ts", root));

Deno.test("drift: delivery helpers in create-checkout match the mirrors", async () => {
  const s = await src();
  assertStringIncludes(s, "function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {");
  assertStringIncludes(s, "function deliveryFeeCents(miles: number): number | null {");
  assertStringIncludes(s, "function parseTipCents(raw: unknown): number | null {");
  assertStringIncludes(s, "if (!Number.isFinite(miles) || miles < 0 || miles > DELIVERY_MAX_MILES) return null;");
  assertStringIncludes(s, "if (!Number.isInteger(n) || n < 0 || n > TIP_MAX_CENTS) return null;");
  assertStringIncludes(s, "const LILYS_LAT = 28.09175;");
  assertStringIncludes(s, "const LILYS_LON = -80.56608;");
  assertStringIncludes(s, "const DELIVERY_MAX_MILES = 5;");
  assertStringIncludes(s, "const DELIVERY_MIN_CENTS = 1500;");
  assertStringIncludes(s, "const TIP_MAX_CENTS = 10000;");
  assertStringIncludes(s, "if (miles <= 2) return 0;");
  assertStringIncludes(s, "if (miles <= 3.5) return 500;");
  assertStringIncludes(s, "return 2 * 3958.8 * Math.asin(Math.sqrt(a));");
});

Deno.test("drift: total = food - discount + tax + delivery + tip, tax on food only", async () => {
  const s = await src();
  assertStringIncludes(s, "const tax = Math.round((subtotal - discount) * taxRate);");
  assertStringIncludes(s, "const total = subtotal - discount + tax + deliveryFee + tip;");
});

Deno.test("drift: a discount reaches Stripe as a one-use coupon for the exact amount", async () => {
  const s = await src();
  assertStringIncludes(s, 'c.set("amount_off", String(discount));');
  assertStringIncludes(s, 'c.set("max_redemptions", "1");');
  assertStringIncludes(s, 'form.set("discounts[0][coupon]", coupon.id);');
});

Deno.test("drift: Square refuses anything it cannot charge correctly", async () => {
  const s = await src();
  assertStringIncludes(s, 'if (provider === "square" && (discount > 0 || deliveryFee > 0 || tip > 0)) {');
});

Deno.test("drift: tips only ride delivery orders; minimum is checked on food after discounts", async () => {
  const s = await src();
  assertStringIncludes(s, 'const tip = fulfilment === "delivery" ? parseTipCents(body.tip_cents) : 0;');
  assertStringIncludes(s, "if (subtotal - discount < DELIVERY_MIN_CENTS) {");
});

Deno.test("fee: every tier boundary", () => {
  assertEquals(deliveryFeeCents(0), 0);
  assertEquals(deliveryFeeCents(2), 0);
  assertEquals(deliveryFeeCents(2.01), 500);
  assertEquals(deliveryFeeCents(3.5), 500);
  assertEquals(deliveryFeeCents(3.51), 1000);
  assertEquals(deliveryFeeCents(5), 1000);
  assertEquals(deliveryFeeCents(5.01), null);
  assertEquals(deliveryFeeCents(-0.1), null);
  assertEquals(deliveryFeeCents(NaN), null);
  assertEquals(deliveryFeeCents(Infinity), null);
});

Deno.test("fee: never more than $10, and the constants agree with Kareem's rules", () => {
  for (let m = 0; m <= DELIVERY_MAX_MILES; m += 0.05) assert((deliveryFeeCents(m) ?? 0) <= 1000);
  assertEquals(DELIVERY_MIN_CENTS, 1500);
  assertEquals(TIP_MAX_CENTS, 10000);
});

Deno.test("distance: zero at the restaurant, one degree of latitude ~69 miles", () => {
  assertEquals(milesBetween(LILYS_LAT, LILYS_LON, LILYS_LAT, LILYS_LON), 0);
  const deg = milesBetween(28, -80, 29, -80);
  assert(deg > 68.8 && deg < 69.3, `got ${deg}`);
});

Deno.test("distance: real Census-geocoded addresses land in the right tier", () => {
  // 1000 W New Haven Ave, Melbourne (across the causeway)
  const melb = milesBetween(LILYS_LAT, LILYS_LON, 28.07889, -80.63804);
  assert(melb > 4.2 && melb < 4.7, `Melbourne ${melb}`);
  assertEquals(deliveryFeeCents(melb), 1000);
  // 2200 A1A, Indian Harbour Beach (up the island)
  const ihb = milesBetween(LILYS_LAT, LILYS_LON, 28.14088, -80.58168);
  assert(ihb > 3.3 && ihb < 3.8, `IHB ${ihb}`);
});

Deno.test("tip: blanks are zero, whole cents only, capped at $100", () => {
  assertEquals(parseTipCents(undefined), 0);
  assertEquals(parseTipCents(null), 0);
  assertEquals(parseTipCents(""), 0);
  assertEquals(parseTipCents(300), 300);
  assertEquals(parseTipCents("500"), 500);
  assertEquals(parseTipCents(10000), 10000);
  assertEquals(parseTipCents(10001), null);
  assertEquals(parseTipCents(2.5), null);
  assertEquals(parseTipCents(-1), null);
  assertEquals(parseTipCents("abc"), null);
});
