/* Sticker and referral links (2026-10-10). A discount anyone can copy is
 * money out of the till, so: random tokens only, single-use stickers claimed
 * atomically, first online order only, never a typed code. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { clubCapCents, codeDiscountCents, TOKEN_RE } from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const src = () => Deno.readTextFile(new URL("create-checkout/index.ts", root));

Deno.test("drift: discount-link rules in create-checkout", async () => {
  const s = await src();
  assertStringIncludes(s, "const TOKEN_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;");
  assertStringIncludes(s, 'const PAID_STATUSES = ["paid", "making", "ready", "done"];');
  assertStringIncludes(s, "if (!Number.isFinite(percent) || percent <= 0 || percent > 50 || afterPromos <= 0) return 0;");
  // first online order only for stickers and referral friends; club gifts work on any order
  assertStringIncludes(s, 'if (t.kind !== "club" && !(await firstOrder())) {');
  // stickers and club welcome gifts are both single-use, claimed atomically
  assertStringIncludes(s, 'if (tokenRow?.kind === "sticker" || tokenRow?.kind === "club") {');
  // a sticker is claimed in the database after the order exists; losing cancels the order
  assertStringIncludes(s, 'await db.rpc("claim_sticker", { p_token: tokenRow.token, p_order: order.id });');
  assert(s.indexOf('db.rpc("claim_sticker"') > s.indexOf('.from("orders")\n      .insert('));
  assert(s.indexOf('db.rpc("claim_sticker"') < s.indexOf('if (demo) {'));
  // referral stays off unless app_config says exactly "true"
  assertStringIncludes(s, 'const referralOn = (cfg.referral_enabled ?? "").trim() === "true";');
  // the code discount is measured after menu promotions and never exceeds what's left
  // Club gifts and bag stickers share the cap; referral links don't
  assertStringIncludes(s, 'const capped = t.kind === "club" || t.kind === "sticker";');
  assertStringIncludes(s, "const cents = Math.min(codeDiscountCents(offerable(), pct), capped ? clubCap : Infinity, offerable());");
  // the Club cap: same helper as the mirror, read from app_config
  assertStringIncludes(s, "const clubCap = clubCapCents(cfg.club_max_cents);");
  assertStringIncludes(s, "  const n = Number(raw);\n  return Number.isInteger(n) && n > 0 ? n : Infinity;");
});

Deno.test("drift: order.js never sends a token from a query string", async () => {
  const orderJs = await Deno.readTextFile(new URL("../../order.js", root));
  assertStringIncludes(orderJs, "const m = /^#([tr])=([23456789A-Za-z]{10})$/.exec(location.hash);");
  assert(!/searchParams\.get\("[tr]"\)/.test(orderJs));
});

Deno.test("percent off what is left after promotions", () => {
  assertEquals(codeDiscountCents(5000, 5), 250);
  assertEquals(codeDiscountCents(1999, 5), 100); // 99.95 rounds to 100
  assertEquals(codeDiscountCents(0, 5), 0);
  assertEquals(codeDiscountCents(-100, 5), 0);
});

Deno.test("percent is bounded: nothing outside 1..50", () => {
  assertEquals(codeDiscountCents(5000, 0), 0);
  assertEquals(codeDiscountCents(5000, -10), 0);
  assertEquals(codeDiscountCents(5000, 51), 0);
  assertEquals(codeDiscountCents(5000, NaN), 0);
  assertEquals(codeDiscountCents(5000, 50), 2500);
});

Deno.test("tokens: 10 chars from the no-lookalike alphabet, nothing else", () => {
  assert(TOKEN_RE.test("23456789AB"));
  assert(!TOKEN_RE.test("23456789A"));     // too short
  assert(!TOKEN_RE.test("23456789ABC"));   // too long
  assert(!TOKEN_RE.test("0OIL1ABCDE"));    // lookalikes never minted
  assert(!TOKEN_RE.test("abcdefghjk"));    // server upper-cases first
  assert(!TOKEN_RE.test("SAVE5SAVE5'")); 
});

Deno.test("Club welcome: 10% off, never more than the cap", () => {
  const cap = clubCapCents("750");
  const club = (food: number) => Math.min(codeDiscountCents(food, 10), cap, food);
  assertEquals(club(6300), 630); // the average order: $6.30 off
  assertEquals(club(7500), 750);
  assertEquals(club(23047), 750); // the biggest order so far: still $7.50
  assertEquals(clubCapCents(undefined), Infinity);
  assertEquals(clubCapCents("abc"), Infinity);
  assertEquals(clubCapCents("0"), Infinity);
});
