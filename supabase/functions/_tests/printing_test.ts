/* Auto-printing on the kitchen's Epson (2026-10-24). */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("printing: the ticket's ready-by minutes match the website's promise", async () => {
  const kitchen = await read("../../../kitchen.js");
  const data = await read("../../../data.js");
  const k = kitchen.match(/const READY_MIN = \{ pickup: (\d+), delivery: (\d+) \};/);
  const p = data.match(/prepMinutes: "(\d+)"/);
  const d = data.match(/deliveryMinutes: "(\d+)"/);
  assert(k && p && d, "READY_MIN, prepMinutes or deliveryMinutes missing");
  assertEquals([k[1], k[2]], [p[1], d[1]]);
});

Deno.test("printing: a claim only lands while printed_at is still empty", async () => {
  const api = await read("../kitchen-api/index.ts");
  const claim = api.slice(api.indexOf('body.action === "print_claim"'), api.indexOf('body.action === "print_release"'));
  assertStringIncludes(claim, '.is("printed_at", null)');
  assertStringIncludes(claim, "claimed: (data ?? []).length > 0");
});

Deno.test("printing: the tablet claims before it sends, and skips orders it didn't claim", async () => {
  const kitchen = await read("../../../kitchen.js");
  const auto = kitchen.slice(kitchen.indexOf("async function autoPrint()"), kitchen.indexOf("function openPrinter()"));
  const claimAt = auto.indexOf('call({ action: "print_claim"');
  const sendAt = auto.indexOf("epsonSend(receiptXML(o))");
  assert(claimAt > 0 && sendAt > claimAt, "claim must come before the print");
  assertStringIncludes(auto, "if (!claimed) continue;");
});

Deno.test("printing: existing orders were marked printed so switching on doesn't print history", async () => {
  const mig = await read("../../migrations/20261024_printed_at.sql");
  assertStringIncludes(mig, "update orders set printed_at = now() where printed_at is null;");
});
