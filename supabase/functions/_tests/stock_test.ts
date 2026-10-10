/* Stock control, matching Kareem's Sauce menu editor (2026-10-10): on, out
 * today (back at 4am Florida time), out until switched back, hidden. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { nextFloridaMorning, OUT_FOREVER, stockPatch, stockState } from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const fnBody = (src: string) => src.slice(src.indexOf("function stockState("), src.indexOf("}\n", src.indexOf("function stockState(")) + 2);

Deno.test("drift: stockState is byte-identical in kitchen-api, create-checkout and the mirror", async () => {
  const k = await Deno.readTextFile(new URL("kitchen-api/index.ts", root));
  const c = await Deno.readTextFile(new URL("create-checkout/index.ts", root));
  const m = await Deno.readTextFile(new URL("_tests/mirrors.ts", root));
  assertEquals(fnBody(c), fnBody(k));
  assertEquals(fnBody(m), fnBody(k));
  assertStringIncludes(k, "function nextFloridaMorning(now: Date): string {");
  assertStringIncludes(k, 'const OUT_FOREVER = "2999-01-01T00:00:00.000Z";');
  // checkout refuses anything not "on", dishes and add-ons alike
  assertStringIncludes(c, 'if (!m || !m.orderable || stockState(m.out_until, m.hidden, nowMs) !== "on") {');
  assertStringIncludes(c, 'available: stockState(r.out_until, r.hidden, nowMs) === "on"');
});

const NOW = Date.parse("2026-10-10T18:00:00Z");

Deno.test("states: null is on, past is on, future is today, far future is off, hidden wins", () => {
  assertEquals(stockState(null, false, NOW), "on");
  assertEquals(stockState(undefined, undefined, NOW), "on");
  assertEquals(stockState("2026-10-10T17:59:59Z", false, NOW), "on");
  assertEquals(stockState("2026-10-11T08:00:00Z", false, NOW), "today");
  assertEquals(stockState(OUT_FOREVER, false, NOW), "off");
  assertEquals(stockState("2999-01-01T00:00:00+00:00", false, NOW), "off"); // as Postgres returns it
  assertEquals(stockState(null, true, NOW), "hidden");
  assertEquals(stockState(OUT_FOREVER, true, NOW), "hidden");
  assertEquals(stockState("garbage", false, NOW), "on");
});

Deno.test("out today comes back at 4am Florida time the next morning", () => {
  // 2pm EDT on Sat 10 Oct -> 4am EDT Sun 11 Oct = 08:00Z
  assertEquals(nextFloridaMorning(new Date("2026-10-10T18:00:00Z")), "2026-10-11T08:00:00.000Z");
  // 11:30pm EDT -> still the next morning
  assertEquals(nextFloridaMorning(new Date("2026-10-11T03:30:00Z")), "2026-10-11T08:00:00.000Z");
  // 2am EDT (after midnight, before 4) -> this same morning
  assertEquals(nextFloridaMorning(new Date("2026-10-11T06:00:00Z")), "2026-10-11T08:00:00.000Z");
  // winter (EST, UTC-5): 4am = 09:00Z
  assertEquals(nextFloridaMorning(new Date("2026-12-01T20:00:00Z")), "2026-12-02T09:00:00.000Z");
});

Deno.test("out today survives the DST changes overnight", () => {
  // clocks go back 1 Nov 2026 2am EDT -> 1am EST; 4am EST = 09:00Z
  assertEquals(nextFloridaMorning(new Date("2026-11-01T02:00:00Z")), "2026-11-01T09:00:00.000Z");
  // clocks go forward 14 Mar 2027 2am EST -> 3am EDT; 4am EDT = 08:00Z
  assertEquals(nextFloridaMorning(new Date("2027-03-14T03:00:00Z")), "2027-03-14T08:00:00.000Z");
});

Deno.test("patches: each state writes exactly what reads back as that state", () => {
  const now = new Date(NOW);
  for (const s of ["on", "today", "off", "hidden"] as const) {
    const p = stockPatch(s, now);
    assertEquals(stockState(p.out_until, p.hidden, NOW), s);
  }
  // switching back on clears both columns, so nothing lingers
  assertEquals(stockPatch("on", now), { out_until: null, hidden: false });
  assert(Date.parse(stockPatch("today", now).out_until!) > NOW);
});
