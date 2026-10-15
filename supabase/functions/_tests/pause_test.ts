/* Pausing online ordering from the kitchen screen (2026-10-15). */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { OUT_FOREVER, pauseUntil } from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, root));

Deno.test("drift: pauseUntil mirror matches kitchen-api", async () => {
  const k = await read("kitchen-api/index.ts");
  assertStringIncludes(k, `function pauseUntil(mode: PauseMode, now: Date): string {
  if (mode === "resume") return "";
  if (mode === "on") return OUT_FOREVER;
  if (mode === "today") return nextFloridaMorning(now);
  return new Date(now.getTime() + Number(mode) * 60_000).toISOString();
}`);
});

Deno.test("pause: 20 minutes and 1 hour from now", () => {
  const now = new Date("2026-10-15T23:00:00Z");
  assertEquals(pauseUntil("20", now), "2026-10-15T23:20:00.000Z");
  assertEquals(pauseUntil("60", now), "2026-10-16T00:00:00.000Z");
});

Deno.test("pause: rest of today ends at the next 4am Florida", () => {
  // 7pm Florida (EDT) on the 15th -> 4am Florida on the 16th = 08:00Z
  assertEquals(pauseUntil("today", new Date("2026-10-15T23:00:00Z")), "2026-10-16T08:00:00.000Z");
});

Deno.test("pause: until resume is far future, resume clears it", () => {
  assertEquals(pauseUntil("on", new Date()), OUT_FOREVER);
  assertEquals(pauseUntil("resume", new Date()), "");
});

Deno.test("drift: create-checkout refuses while paused, with the same exemptions as closed", async () => {
  const c = await read("create-checkout/index.ts");
  assertStringIncludes(c, `const pausedUntil = Date.parse(cfg.orders_paused_until ?? "");`);
  assertStringIncludes(c, "if (!demo && !testOrder && pausedUntil > Date.now()) {");
});

Deno.test("drift: referral thank-you is once per customer", async () => {
  const c = await read("create-checkout/index.ts");
  assertStringIncludes(c, "const usable = spent ? undefined :");
});
