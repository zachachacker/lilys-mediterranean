/* Order state machine — all 36 (from → to) pairs over the 6 statuses.
 * The DB CHECK constraint on orders.status pins the same 6 values:
 *   status = ANY (ARRAY['pending','paid','making','ready','done','canceled'])
 * (verified against the live schema, migration 20260716161013 ordering_schema)
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ALLOWED_FROM } from "./mirrors.ts";

const STATUSES = ["pending", "paid", "making", "ready", "done", "canceled"] as const;
type Status = typeof STATUSES[number];

/** Mirrors kitchen-api/index.ts:71-77: `const from = ALLOWED_FROM[to]` then `.in("status", from)`. */
const permitted = (from: Status, to: string): boolean => {
  const allowed = ALLOWED_FROM[to];
  if (!allowed) return false; // :72 — unknown target → 400 Bad transition
  return Array.isArray(allowed) && allowed.includes(from);
};

/** What the real handler does with `to` before touching the DB: `!from` → 400. */
const reachesDatabase = (to: string): boolean => Boolean(ALLOWED_FROM[to]);

/** The full expected matrix, written out independently of ALLOWED_FROM. */
const EXPECTED: Record<Status, Status[]> = {
  pending: [],                       // no KDS transition may originate at pending
  paid: ["making", "canceled"],
  making: ["paid", "ready", "canceled"],
  ready: ["making", "done", "canceled"],
  done: ["making", "ready"],
  canceled: [],                      // terminal
};

Deno.test("state machine: all 36 pairs match the expected matrix", () => {
  const surprises: string[] = [];
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const actual = permitted(from, to);
      const expected = EXPECTED[from].includes(to);
      if (actual !== expected) surprises.push(`${from} -> ${to}: got ${actual}, expected ${expected}`);
    }
  }
  assertEquals(surprises, [], `state machine diverged:\n${surprises.join("\n")}`);
});

Deno.test("state machine: 'canceled' is TERMINAL — no target accepts it as a source", () => {
  // Phase 1A contested claim. Printed for the record.
  const values = Object.entries(ALLOWED_FROM).map(([to, from]) => `${to}: [${from.join(", ")}]`);
  console.log("ALLOWED_FROM (key = TARGET, array = permitted SOURCE states):\n  " + values.join("\n  "));

  const everySourceState = new Set(Object.values(ALLOWED_FROM).flat());
  assertEquals(
    everySourceState.has("canceled"),
    false,
    "'canceled' appears as a permitted source — a cancelled order could be resurrected",
  );
  for (const to of STATUSES) assertEquals(permitted("canceled", to), false, `canceled -> ${to} must be denied`);
});

Deno.test("state machine: 'pending' is not reachable-from via the KDS", () => {
  // Only the webhooks / reconcile move an order out of pending, never a cook.
  const everySourceState = new Set(Object.values(ALLOWED_FROM).flat());
  assertEquals(everySourceState.has("pending"), false);
  for (const to of STATUSES) assertEquals(permitted("pending", to), false, `pending -> ${to} must be denied`);
});

Deno.test("state machine: 'pending' is not a valid TARGET — no un-paying an order", () => {
  assertEquals(ALLOWED_FROM["pending"], undefined);
  for (const from of STATUSES) assertEquals(permitted(from, "pending"), false);
});

Deno.test("state machine: 'done' is NOT terminal — done -> making has no server-side time bound", () => {
  // UI limits recall to 1h (kitchen.js:21 RECALL_WINDOW_MS, gated at :430);
  // the server does not. Any completed order, of any age, can be recalled.
  assert(permitted("done", "making"), "done -> making (recall) should be permitted");
  assert(permitted("done", "ready"), "done -> ready (undo picked-up) should be permitted");
});

Deno.test("state machine: a paid order can be canceled, but never refunded by this API", () => {
  assert(permitted("paid", "canceled"));
  assert(permitted("making", "canceled"));
  assert(permitted("ready", "canceled"));
  // There is no 'refunded' status anywhere in the system.
  assertEquals(STATUSES.includes("refunded" as Status), false);
  assertEquals(ALLOWED_FROM["refunded"], undefined);
});

Deno.test("state machine: unknown / injected target statuses are rejected", () => {
  for (
    const to of [
      "", "PAID", "Paid", "refunded", "deleted", "admin", "paid ", " paid",
      "paid,canceled", "paid)", "*", "null", "undefined", "__proto__",
      "constructor", "toString", "hasOwnProperty",
    ]
  ) {
    assertEquals(permitted("paid", to), false, `target ${JSON.stringify(to)} must be rejected`);
  }
});

Deno.test("state machine: prototype keys authorise nothing, but DO reach the DB (robustness gap)", () => {
  // ALLOWED_FROM is a plain object literal, so ALLOWED_FROM["toString"] resolves
  // to Function.prototype.toString — TRUTHY. The handler's guard is `if (!from ||
  // !id) return 400`, so these targets slip past it and reach
  // `.in("status", <a function>)`, producing a 500 instead of a clean 400.
  //
  // Not an authorisation bypass: no source state matches, and the CHECK
  // constraint on orders.status would reject the write regardless. It is an
  // unvalidated-input path into the database — recorded as SM-05.
  const protoKeys = ["toString", "constructor", "valueOf", "hasOwnProperty", "isPrototypeOf"];

  for (const key of protoKeys) {
    const v = (ALLOWED_FROM as Record<string, unknown>)[key];
    assertEquals(Array.isArray(v), false, `${key} must not resolve to an array — that would be a real bypass`);
    assertEquals(permitted("paid", key), false, `${key} must authorise nothing`);
    assert(reachesDatabase(key), `${key} is expected to slip past the !from guard (documents SM-05)`);
  }

  // A genuinely unknown target is correctly stopped before the DB.
  for (const key of ["refunded", "admin", ""]) {
    assertEquals(reachesDatabase(key), false, `${key} should be rejected at the guard`);
  }

  // __proto__ is special: it resolves to Object.prototype, also truthy.
  assertEquals(permitted("paid", "__proto__"), false);
});
