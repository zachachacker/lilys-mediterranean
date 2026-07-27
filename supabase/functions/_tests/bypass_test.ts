/* The closed-day test bypass (go-live runbook) — added 2026-07-28 to replace
 * runbook Step 5 (edit HOURS, redeploy, revert). Zachary's constraints, pinned:
 *   1. the test order rides the full live path (nothing here touches provider
 *      selection, pricing, or webhooks — see drift pins),
 *   2. it is visibly marked (TEST- code prefix, [SYSTEM TEST ORDER] notes tag),
 *   3. the public stays refused outside hours — no widening, and the bypass
 *      never bridges into demo mode.
 *
 * Tier 0 — inert. Pure functions via mirrors.ts; no network, no database.
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { CODE_ALPHABET, decideTestOrder, hoursGateRefuses, makeCode } from "./mirrors.ts";

const TOKEN = "a-long-random-runbook-token";

/* ── the token decision ─────────────────────────────────────────────────── */

Deno.test("bypass: config token + matching carried token + live mode → test order", () => {
  assertEquals(decideTestOrder({ demo: false, cfgToken: TOKEN, provided: TOKEN }), true);
});

Deno.test("bypass: NEVER bridges into demo mode — same match, demo=true → no effect", () => {
  assertEquals(decideTestOrder({ demo: true, cfgToken: TOKEN, provided: TOKEN }), false);
});

Deno.test("bypass: config row absent → carried token has no effect, whatever it says", () => {
  assertEquals(decideTestOrder({ demo: false, cfgToken: "", provided: TOKEN }), false);
  assertEquals(decideTestOrder({ demo: false, cfgToken: "   ", provided: TOKEN }), false, "whitespace-only config is absent");
});

Deno.test("bypass: wrong or empty carried token → no effect", () => {
  assertEquals(decideTestOrder({ demo: false, cfgToken: TOKEN, provided: "wrong" }), false);
  assertEquals(decideTestOrder({ demo: false, cfgToken: TOKEN, provided: "" }), false);
  assertEquals(decideTestOrder({ demo: false, cfgToken: TOKEN, provided: "   " }), false);
});

Deno.test("bypass: both sides empty is NOT a match — empty never unlocks anything", () => {
  assertEquals(decideTestOrder({ demo: false, cfgToken: "", provided: "" }), false);
});

Deno.test("bypass: carried token is sliced to 64 chars — an over-long config token can never match", () => {
  const long = "x".repeat(80);
  assertEquals(decideTestOrder({ demo: false, cfgToken: long, provided: long }), false, "80-char config vs 64-char slice");
  const exact64 = "y".repeat(64);
  assertEquals(decideTestOrder({ demo: false, cfgToken: exact64, provided: exact64 + "overflow" }), true, "slice makes the carried token 64 chars, matching a 64-char config");
});

/* ── the opening-hours gate composition ─────────────────────────────────── */

Deno.test("hours gate: public on a closed day is refused, exactly as before", () => {
  assertEquals(hoursGateRefuses({ demo: false, testOrder: false, open: false }), true);
});

Deno.test("hours gate: test order on a closed day goes through", () => {
  assertEquals(hoursGateRefuses({ demo: false, testOrder: true, open: false }), false);
});

Deno.test("hours gate: open hours unchanged for everyone", () => {
  assertEquals(hoursGateRefuses({ demo: false, testOrder: false, open: true }), false);
  assertEquals(hoursGateRefuses({ demo: false, testOrder: true, open: true }), false);
});

Deno.test("hours gate: demo mode never hits the gate (pre-existing behaviour, unchanged)", () => {
  assertEquals(hoursGateRefuses({ demo: true, testOrder: false, open: false }), false);
});

/* ── the marking ────────────────────────────────────────────────────────── */

Deno.test("marking: TEST- prefixed codes keep the code shape and alphabet", () => {
  for (const len of [4, 5]) {
    const c = makeCode(len, "TEST");
    assert(c.startsWith("TEST-"));
    assertEquals(c.length, 5 + len);
    for (const ch of c.slice(5)) assert(CODE_ALPHABET.includes(ch), `char ${ch} outside alphabet`);
  }
});

Deno.test("marking: default prefix is still LM- — public orders unchanged", () => {
  assert(makeCode(4).startsWith("LM-"));
});
