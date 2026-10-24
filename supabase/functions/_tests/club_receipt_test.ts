/* Lily's Club QR on the printed kitchen receipt (2026-10-20). */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("receipt: the printed Club rungs match app_config club_reward_tiers", async () => {
  const kitchen = await read("../../../kitchen.js");
  const mig = await read("../../migrations/20261024_club_points.sql");
  assertStringIncludes(kitchen, 'const CLUB_RUNGS = "50 points = $5 off, 100 = $12 off";');
  assertStringIncludes(mig, "('club_reward_tiers', '50:500,100:1200')");
});

Deno.test("receipt: the QR is static and points at the Club page tagged receipt", async () => {
  const kitchen = await read("../../../kitchen.js");
  assertStringIncludes(kitchen, "// QR for https://lilysmediterraneanfresh.com/club.html?src=receipt");
  assert(/const CLUB_QR = '<svg[^']+<\/svg>';/.test(kitchen), "CLUB_QR must be an inline SVG");
});

Deno.test("join: only the receipt is told apart, and only via a fixed value", async () => {
  const deals = await read("../deals/index.ts");
  assertStringIncludes(deals, 'const source = body.via === "receipt" ? "signup-receipt" : "signup";');
  // club.html became the points account page (2026-10-24); the receipt QR still
  // lands there, and the deals list keeps telling the receipt source apart
  const mig = await read("../../migrations/20261020_club_receipt_source.sql");
  assertStringIncludes(mig, "'signup-receipt'");
});
