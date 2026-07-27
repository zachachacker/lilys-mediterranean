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
import { CODE_ALPHABET, decideTestOrder, extractTestToken, hoursGateRefuses, makeCode } from "./mirrors.ts";

const TOKEN = "a-long-random-runbook-token";

/* ── the carry: "#test:<value>" typed into the notes box (B-4) ──────────── */

Deno.test("carry: token extracted from the head of notes; the rest survives as the real note", () => {
  const r = extractTestToken(`#test:${TOKEN} extra garlic sauce please`);
  assertEquals(r.token, TOKEN);
  assertEquals(r.notes, "extra garlic sauce please");
});

Deno.test("carry: token alone → empty notes become null", () => {
  const r = extractTestToken(`#test:${TOKEN}`);
  assertEquals(r.token, TOKEN);
  assertEquals(r.notes, null);
});

Deno.test("carry: the syntax is stripped from stored notes even when the value is WRONG — a secret is never persisted", () => {
  const r = extractTestToken("#test:wrong-guess my actual note");
  assertEquals(r.token, "wrong-guess");
  assertEquals(r.notes, "my actual note", "the guess does not reach the kitchen ticket");
});

Deno.test("carry: no syntax → no token, notes pass through untouched", () => {
  const r = extractTestToken("extra garlic sauce please");
  assertEquals(r.token, "");
  assertEquals(r.notes, "extra garlic sauce please");
});

Deno.test("carry: syntax mid-notes does NOT trigger — start-anchored on purpose", () => {
  const r = extractTestToken(`please hurry #test:${TOKEN}`);
  assertEquals(r.token, "");
  assertEquals(r.notes, `please hurry #test:${TOKEN}`);
});

Deno.test("carry: '#test:' with no value is not a match", () => {
  const r = extractTestToken("#test: my note");
  assertEquals(r.token, "");
  assertEquals(r.notes, "#test: my note");
});

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

Deno.test("bypass: long tokens match whole — no truncation to create false accepts or rejects", () => {
  const long = "x".repeat(80);
  assertEquals(decideTestOrder({ demo: false, cfgToken: long, provided: long }), true);
  assertEquals(decideTestOrder({ demo: false, cfgToken: long, provided: long.slice(0, 64) }), false, "a truncated guess is just a wrong token");
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
