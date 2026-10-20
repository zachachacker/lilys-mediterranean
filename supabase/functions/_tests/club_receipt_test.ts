/* Lily's Club QR on the printed kitchen receipt (2026-10-20). */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("receipt: the printed Club percent matches the website's", async () => {
  const kitchen = await read("../../../kitchen.js");
  const data = await read("../../../data.js");
  const k = kitchen.match(/const CLUB_PERCENT = (\d+);/);
  const d = data.match(/clubPercent: (\d+),/);
  assert(k && d, "CLUB_PERCENT or clubPercent missing");
  assertEquals(k[1], d[1]);
});

Deno.test("receipt: the QR is static and points at the Club page tagged receipt", async () => {
  const kitchen = await read("../../../kitchen.js");
  assertStringIncludes(kitchen, "// QR for https://lilysmediterraneanfresh.com/club.html?src=receipt");
  assert(/const CLUB_QR = '<svg[^']+<\/svg>';/.test(kitchen), "CLUB_QR must be an inline SVG");
});

Deno.test("join: only the receipt is told apart, and only via a fixed value", async () => {
  const deals = await read("../deals/index.ts");
  assertStringIncludes(deals, 'const source = body.via === "receipt" ? "signup-receipt" : "signup";');
  const page = await read("../../../club.html");
  assertStringIncludes(page, 'await post({ action: "join", email, via: window.LILYS_TRACK?.source() || "" });');
  const mig = await read("../../migrations/20261020_club_receipt_source.sql");
  assertStringIncludes(mig, "'signup-receipt'");
});
