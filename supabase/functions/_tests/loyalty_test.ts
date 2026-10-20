/* Loyalty (2026-10-20): every 5 paid online orders, $10 off a later one.
 * Banked: earned = floor(paid / every), spent = paid orders carrying it. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { loyaltyDue } from "./mirrors.ts";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("loyalty: earned every 5 paid orders, spent once each", () => {
  assertEquals(loyaltyDue(0, 0, 5), false);
  assertEquals(loyaltyDue(4, 0, 5), false);
  assertEquals(loyaltyDue(5, 0, 5), true); // the 6th order gets it
  assertEquals(loyaltyDue(5, 1, 5), false); // already spent
  assertEquals(loyaltyDue(9, 1, 5), false);
  assertEquals(loyaltyDue(10, 1, 5), true);
  assertEquals(loyaltyDue(12, 0, 5), true); // two banked; one per order
});

Deno.test("loyalty: a bad setting never gives money away", () => {
  assertEquals(loyaltyDue(50, 0, 0), false);
  assertEquals(loyaltyDue(50, 0, 1), false);
  assertEquals(loyaltyDue(50, 0, NaN), false);
});

Deno.test("drift: create-checkout loyalty", async () => {
  const s = await read("../create-checkout/index.ts");
  assertStringIncludes(s, "  if (!Number.isInteger(every) || every < 2) return false;\n  return Math.floor(paidOrders / every) > usedRewards;");
  // off unless app_config says exactly "true", and only with a phone fingerprint
  assertStringIncludes(s, '(cfg.loyalty_enabled ?? "").trim() === "true" && custHash && Number.isInteger(loyaltyCents) && loyaltyCents > 0');
  // spent = paid orders that carry it; never more than what's left (not lunch)
  assertStringIncludes(s, `.filter("discounts", "cs", '[{"id":"loyalty"}]')`);
  assertStringIncludes(s, "const cents = Math.min(loyaltyCents, offerable());");
  assertStringIncludes(s, 'applied.push({ id: "loyalty",');
  // after the discount links, before tax is worked out
  assert(s.indexOf("loyaltyDue(paid.count") > s.indexOf('console.error("discount link check failed:"'));
  assert(s.indexOf("loyaltyDue(paid.count") < s.indexOf("const tax = Math.round((subtotal - discount) * taxRate);"));
});

Deno.test("drift: the progress counter is the same in order-status and kitchen-api", async () => {
  const pick = (s: string) => s.slice(s.indexOf("// Loyalty progress (2026-10-20"), s.indexOf("\n}\n", s.indexOf("function loyaltyAt(")) + 3);
  const a = pick(await read("../order-status/index.ts"));
  const b = pick(await read("../kitchen-api/index.ts"));
  assert(a.includes("function loyaltyAt("), "loyaltyAt missing from order-status");
  assertEquals(a, b);
  // the customer hash never goes out with the kitchen list
  assertStringIncludes(await read("../kitchen-api/index.ts"), "const orders = (data ?? []).map(({ customer_hash, ...o }) => {");
});

Deno.test("website perks say what the loyalty settings do", async () => {
  const mig = await read("../../migrations/20261020_loyalty.sql");
  assertStringIncludes(mig, "('loyalty_every', '5'), ('loyalty_cents', '1000')");
  for (const page of ["../../../order.html", "../../../index.html"]) {
    assertStringIncludes(await read(page), "<li>$10 off after every 5 orders</li>");
  }
});
