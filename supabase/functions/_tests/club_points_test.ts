/* Lily's Club accounts + points (2026-10-24). Points are derived from orders;
 * the counting code lives in two functions and must stay identical. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));
const START = "/* ── Lily's Club points (2026-10-24; byte-identical";
const END = "/* ── end of the shared copy";
const shared = (src: string) => src.slice(src.indexOf(START), src.indexOf(END));

// load the real copy from club/index.ts so the tests exercise the shipped code
const club = await read("../club/index.ts");
const mod = await import(`data:application/typescript,${encodeURIComponent(
  shared(club).replace(/\nfunction /g, "\nexport function ") + "\nexport { CLUB_PAID };")}`);
const { clubPoints, clubTiers } = mod;

const o = (over: Record<string, unknown>) => ({
  subtotal_cents: 0, discount_cents: 0, status: "done", created_at: new Date(0).toISOString(), demo: false,
  customer_email: null, club_email: null, discounts: null, ...over,
});
const ME = "a@b.com";

Deno.test("club: the two copies are identical", async () => {
  const cc = await read("../create-checkout/index.ts");
  assert(shared(club).length > 500, "shared block missing in club");
  assertEquals(shared(cc), shared(club));
});

Deno.test("club: $1 of food after discounts = 1 point; tax, tips, delivery earn nothing", () => {
  const r = clubPoints(ME, [o({ customer_email: ME, subtotal_cents: 5299, discount_cents: 500 })], 0, Date.now());
  assertEquals(r.earned, 47);
});

Deno.test("club: earns by Stripe email (any case) or the signed-in member; not unpaid, demo or other people's", () => {
  const now = Date.now();
  const r = clubPoints(ME, [
    o({ customer_email: "A@B.com", subtotal_cents: 1000 }),
    o({ club_email: ME, customer_email: "other@x.com", subtotal_cents: 2000 }),
    o({ customer_email: ME, subtotal_cents: 9900, status: "pending" }),
    o({ customer_email: ME, subtotal_cents: 9900, status: "canceled" }),
    o({ customer_email: ME, subtotal_cents: 9900, demo: true }),
    o({ customer_email: "c@d.com", subtotal_cents: 9900 }),
  ], 0, now);
  assertEquals(r.earned, 30);
});

Deno.test("club: a spend holds while unpaid (2h), counts once paid, is freed if they walk away", () => {
  const now = Date.now();
  const spend = [{ id: "club-points", email: ME, points: 50, cents: 500 }];
  const base = o({ customer_email: ME, subtotal_cents: 10000 });
  assertEquals(clubPoints(ME, [base, o({ status: "pending", created_at: new Date(now - 60_000).toISOString(), discounts: spend })], 0, now).balance, 50);
  assertEquals(clubPoints(ME, [base, o({ status: "pending", created_at: new Date(now - 3 * 3600_000).toISOString(), discounts: spend })], 0, now).balance, 100);
  assertEquals(clubPoints(ME, [base, o({ status: "canceled", discounts: spend })], 0, now).balance, 100);
  assertEquals(clubPoints(ME, [base, o({ status: "done", discounts: spend })], 0, now).balance, 50);
  // someone else's spend never touches this member
  assertEquals(clubPoints(ME, [base, o({ discounts: [{ id: "club-points", email: "x@y.com", points: 50 }] })], 0, now).balance, 100);
});

Deno.test("club: in-store adjustments add on", () => {
  assertEquals(clubPoints(ME, [], 25, Date.now()).balance, 25);
});

Deno.test("club: reward tiers parse safely, cheapest first", () => {
  assertEquals(clubTiers("100:1200,50:500"), [{ points: 50, cents: 500 }, { points: 100, cents: 1200 }]);
  assertEquals(clubTiers("50:-1,abc,0:500,,75:750"), [{ points: 75, cents: 750 }]);
  assertEquals(clubTiers(undefined), []);
});

Deno.test("checkout: points re-counted on the server, rung must exist, food must cover it", async () => {
  const cc = await read("../create-checkout/index.ts");
  assertStringIncludes(cc, "const tier = clubTiers(cfg.club_reward_tiers).find((t) => t.points === clubWant);");
  assertStringIncludes(cc, "if (offerable() < tier.cents)");
  assertStringIncludes(cc, "if (balance < tier.points)");
  assertStringIncludes(cc, 'applied.push({ id: "club-points", label: `Lily\'s Club reward: ${tier.points} points`, cents: tier.cents, points: tier.points, email: clubEmail });');
  assertStringIncludes(cc, "club_email: clubEmail,");
});

Deno.test("club: codes are hashed, expire, and lock after 5 wrong tries", () => {
  assertStringIncludes(club, "code_hash: await sha256(`${email}:${code}`)");
  assertStringIncludes(club, "const CODE_TTL_MS = 10 * 60 * 1000;");
  assertStringIncludes(club, "row.attempts >= MAX_TRIES");
  assertStringIncludes(club, "const MAX_SENDS_PER_HOUR = 5;");
  // sessions are stored hashed too
  assertStringIncludes(club, 'insert({ token_hash: await sha256(token), email })');
});
