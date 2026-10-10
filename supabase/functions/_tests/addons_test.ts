/* Add-ons (Kareem, 2026-10-10). Every add-on changes what a customer pays,
 * so the server prices them from its own table and these pin the rules:
 * only groups the dish offers, pick limits, sold-out refused, canonical
 * line keys, and BOGO never giving add-ons away. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  type AddonGroup, type AddonOpt, applyPromotions, lineKey, priceAddons, type Promo, validateCheckoutBody,
} from "./mirrors.ts";

const root = new URL("../", import.meta.url);

const OPTS = new Map<string, AddonOpt>([
  ["side-fries", { id: "side-fries", group_id: "side", name: "Seasoned Fries", price_cents: 430, sort: 0, available: true }],
  ["side-rice", { id: "side-rice", group_id: "side", name: "Rice", price_cents: 430, sort: 2, available: true }],
  ["sauce-tahini", { id: "sauce-tahini", group_id: "sauce", name: "Tahini Sauce (2oz)", price_cents: 120, sort: 1, available: true }],
  ["spice-hot", { id: "spice-hot", group_id: "spice", name: "Make it spicy", price_cents: 75, sort: 0, available: true }],
  ["extra-lamb", { id: "extra-lamb", group_id: "extra", name: "1 Lamb Kabob Skewer", price_cents: 1030, sort: 5, available: false }],
]);
const GROUPS = new Map<string, AddonGroup>([
  ["side", { id: "side", max_select: 3, sort: 0 }],
  ["sauce", { id: "sauce", max_select: 4, sort: 1 }],
  ["extra", { id: "extra", max_select: 9, sort: 3 }],
  ["spice", { id: "spice", max_select: 1, sort: 5 }],
]);
const WRAP = ["side", "sauce", "spice"];

Deno.test("drift: add-on pricing in create-checkout matches the mirror", async () => {
  const s = await Deno.readTextFile(new URL("create-checkout/index.ts", root));
  assertStringIncludes(s, "if (!o || !itemGroups.includes(o.group_id)) return { ok: false, error: \"Invalid cart contents.\" };");
  assertStringIncludes(s, "if (!g || n > g.max_select) return { ok: false, error: \"Invalid cart contents.\" };");
  assertStringIncludes(s, "if (!o.available) return { ok: false, error: `Sorry, ${o.name} is sold out today. Please remove it and try again.` };");
  assertStringIncludes(s, "return opts.length ? `${id}|${[...opts].sort().join(\",\")}` : id;");
  assertStringIncludes(s, "unit_cents: m.price_cents + a.cents, base_cents: m.price_cents,");
  assertStringIncludes(s, "const unit = Math.min(...its.map((l) => l.base_cents ?? l.unit_cents));");
});

Deno.test("no add-ons = no charge", () => {
  const r = priceAddons(WRAP, [], OPTS, GROUPS);
  assert(r.ok);
  assertEquals(r.cents, 0);
  assertEquals(r.addons, []);
});

Deno.test("add-ons are priced from the server table and put in kitchen order", () => {
  const r = priceAddons(WRAP, ["spice-hot", "sauce-tahini", "side-fries"], OPTS, GROUPS);
  assert(r.ok);
  assertEquals(r.cents, 75 + 120 + 430);
  assertEquals(r.addons.map((a) => a.id), ["side-fries", "sauce-tahini", "spice-hot"]);
});

Deno.test("an add-on from a group the dish doesn't offer is refused", () => {
  assertEquals(priceAddons(["side"], ["sauce-tahini"], OPTS, GROUPS).ok, false);
});

Deno.test("unknown and repeated ids are refused", () => {
  assertEquals(priceAddons(WRAP, ["free-lobster"], OPTS, GROUPS).ok, false);
  assertEquals(priceAddons(WRAP, ["side-fries", "side-fries"], OPTS, GROUPS).ok, false);
});

Deno.test("a group's pick limit holds", () => {
  const g = new Map(GROUPS);
  g.set("side", { id: "side", max_select: 1, sort: 0 });
  assertEquals(priceAddons(WRAP, ["side-fries", "side-rice"], OPTS, g).ok, false);
  assertEquals(priceAddons(WRAP, ["side-fries", "side-rice"], OPTS, GROUPS).ok, true);
});

Deno.test("a sold-out add-on is refused by name", () => {
  const r = priceAddons(["extra"], ["extra-lamb"], OPTS, GROUPS);
  assertEquals(r.ok, false);
  if (!r.ok) assertStringIncludes(r.error, "1 Lamb Kabob Skewer is sold out");
});

Deno.test("line keys ignore the order options were picked in", () => {
  assertEquals(lineKey("wrap", ["b", "a"]), lineKey("wrap", ["a", "b"]));
  assertEquals(lineKey("wrap", []), "wrap");
  assert(lineKey("wrap", ["a"]) !== lineKey("wrap", []));
});

Deno.test("validation: the same dish twice is fine with different add-ons, refused when identical", () => {
  const base = { name: "Zach", phone: "3215550100" };
  assert(validateCheckoutBody({ ...base, items: [{ id: "w", qty: 1 }, { id: "w", qty: 1, opts: ["side-fries"] }] }).ok);
  assertEquals(validateCheckoutBody({ ...base, items: [{ id: "w", qty: 1, opts: ["a", "b"] }, { id: "w", qty: 1, opts: ["b", "a"] }] }).ok, false);
  assertEquals(validateCheckoutBody({ ...base, items: [{ id: "w", qty: 1, opts: "side-fries" }] }).ok, false);
  assertEquals(validateCheckoutBody({ ...base, items: [{ id: "w", qty: 1, opts: [1] }] }).ok, false);
  assertEquals(validateCheckoutBody({ ...base, items: [{ id: "w", qty: 1, opts: Array(21).fill("x") }] }).ok, false);
});

Deno.test("bogo: counts a dish across lines and never gives add-ons away", () => {
  const promo: Promo = { id: "p", kind: "bogo", label: "BOGO wrap", item_id: "w", buy_qty: 2, free_qty: 1 };
  const lines = [
    { id: "w", qty: 1, unit_cents: 1300 + 430, base_cents: 1300 },
    { id: "w", qty: 1, unit_cents: 1300, base_cents: 1300 },
  ];
  const r = applyPromotions(lines, [promo]);
  assertEquals(r.subtotal, 3030);
  assertEquals(r.discount, 1300);
});
