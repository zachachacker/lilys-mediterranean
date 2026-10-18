/* Weekly owner report (2026-10-19): the week, new vs returning, sources. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { addDays, lastWeek, type Ord, summarize } from "./mirrors.ts";

const START = "/* ---- pure helpers (mirrored in _tests/mirrors.ts) ---------------------- */";
const END = "/* ----------------------------------------------------------------------- */";

Deno.test("drift: weekly-report pure block matches the mirror verbatim", async () => {
  const src = await Deno.readTextFile(new URL("../weekly-report/index.ts", import.meta.url));
  const mirror = await Deno.readTextFile(new URL("./mirrors.ts", import.meta.url));
  const a = src.indexOf(START);
  const block = src.slice(a, src.indexOf(END, a));
  assertStringIncludes(mirror, block);
});

Deno.test("drift: send guard claims the week with one conditional update, released on failure", async () => {
  const src = await Deno.readTextFile(new URL("../weekly-report/index.ts", import.meta.url));
  assertStringIncludes(src, '.eq("key", "weekly_report_last_week").lt("value", start).select("key");');
  assertStringIncludes(src, 'if (!claimed?.length) return json({ ok: true, note: "already sent", week: start });');
  assertStringIncludes(src, 'if ((cfg.weekly_report_enabled ?? "false").trim() !== "true")');
  assertStringIncludes(src, "await release();");
  // the response never carries the numbers: anyone with the anon key can call it
  assertStringIncludes(src, 'return json({ ok: true, week: start });');
});

Deno.test("week: last full Monday to Sunday, whatever day it runs", () => {
  assertEquals(lastWeek("2026-10-19"), { start: "2026-10-12", end: "2026-10-18" }); // Monday
  assertEquals(lastWeek("2026-10-18"), { start: "2026-10-05", end: "2026-10-11" }); // Sunday
  assertEquals(lastWeek("2026-10-21"), { start: "2026-10-12", end: "2026-10-18" }); // Wednesday
  assertEquals(lastWeek("2026-11-02"), { start: "2026-10-26", end: "2026-11-01" }); // across a month
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
});

// 16:00 UTC is midday in Florida, so the Florida date equals the UTC date
const o = (day: string, hash: string | null, source: string | null, extra: Partial<Ord> = {}): Ord => ({
  created_at: `${day}T16:00:00Z`, status: "done", subtotal_cents: 2000, discount_cents: 0,
  customer_hash: hash, source, items: [{ name: "Falafel Bowl", qty: 1 }], ...extra,
});

Deno.test("new vs returning: new means first ever order is inside the week", () => {
  const orders = [
    o("2026-10-06", "A", "google"),               // A first seen the week before
    o("2026-10-13", "A", "direct"),               // A returns this week
    o("2026-10-14", "B", "google-ads"),           // B new this week
    o("2026-10-16", "B", "google-ads"),           // B twice: still one new customer
    o("2026-10-17", "C", "sticker"),              // C new
    o("2026-10-18", null, "direct"),              // untracked
    o("2026-10-15", "D", "google", { status: "canceled" }), // never counts
    o("2026-10-20", "E", "google"),               // after the week
  ];
  const w = summarize(orders, "2026-10-12", "2026-10-18");
  assertEquals(w.orders, 5);
  assertEquals(w.newCustomers, 2);
  assertEquals(w.returningCustomers, 1);
  assertEquals(w.untracked, 1);
  assertEquals(w.sales, 10000);
  assertEquals(w.prev, { orders: 1, sales: 2000, newCustomers: 1 });
});

Deno.test("Florida clock: a 10:30pm Sunday order belongs to Sunday, not Monday", () => {
  // 02:30 UTC Monday = 22:30 Sunday in Florida (EDT)
  const w = summarize([o("2026-10-18", "A", "google", { created_at: "2026-10-19T02:30:00Z" })], "2026-10-12", "2026-10-18");
  assertEquals(w.orders, 1);
});

Deno.test("sources: orders and new customers per channel, readable names, busiest first", () => {
  const orders = [
    o("2026-10-01", "A", "google"),
    o("2026-10-13", "A", "google"),        // returning via Google
    o("2026-10-14", "B", "google-ads"),
    o("2026-10-15", "C", "google-ads"),
    o("2026-10-16", "D", "old-site"),
    o("2026-10-17", "E", null),
  ];
  const w = summarize(orders, "2026-10-12", "2026-10-18");
  assertEquals(w.bySource.map((s) => [s.label, s.orders, s.newCustomers]), [
    ["Google Ads", 2, 2],
    ["Google search", 1, 0],
    ["Old website", 1, 1],
    ["Unknown (before tracking)", 1, 1],
  ]);
});

Deno.test("food sales are subtotal minus discounts; best sellers by quantity", () => {
  const w = summarize([
    o("2026-10-13", "A", "google", { subtotal_cents: 3000, discount_cents: 500, items: [{ name: "Gyro", qty: 2 }, { name: "Baklava", qty: 1 }] }),
    o("2026-10-14", "B", "google", { subtotal_cents: 1000, discount_cents: null, items: [{ name: "Baklava", qty: 3 }] }),
  ], "2026-10-12", "2026-10-18");
  assertEquals(w.sales, 3500);
  assertEquals(w.top, [{ name: "Baklava", qty: 4 }, { name: "Gyro", qty: 2 }]);
});

Deno.test("month to date counts the bonus base up to the week's Sunday", () => {
  const orders = [
    o("2026-09-30", "A", "google"),   // previous month
    o("2026-10-02", "B", "google"),
    o("2026-10-13", "C", "google"),
    o("2026-10-19", "D", "google"),   // after the week
  ];
  assertEquals(summarize(orders, "2026-10-12", "2026-10-18").monthOrders, 2);
  // a week spanning two months counts the month the Sunday is in
  assertEquals(summarize([o("2026-10-30", "A", "x"), o("2026-11-01", "B", "x")], "2026-10-26", "2026-11-01").monthOrders, 1);
});

Deno.test("all-time report: first order day, and customers who came back within the range", () => {
  const orders = [
    o("2026-10-08", "A", "google"),
    o("2026-10-12", "A", "google"),            // A ordered twice: came back
    o("2026-10-10", "B", "direct"),
    o("2026-10-11", null, "direct"),
    o("2026-10-07", "C", "google", { status: "canceled" }), // never counts, not the first day
  ];
  const first = summarize(orders, "2026-10-12", "2026-10-18").firstDay;
  assertEquals(first, "2026-10-08");
  const all = summarize(orders, first!, "2026-10-18");
  assertEquals([all.orders, all.newCustomers, all.repeatCustomers, all.untracked], [4, 2, 1, 1]);
});

Deno.test("drift: the all-time report runs once, then turns itself off", async () => {
  const src = await Deno.readTextFile(new URL("../weekly-report/index.ts", import.meta.url));
  assertStringIncludes(src, 'const allTime = (cfg.weekly_report_all_time ?? "").trim() === "true";');
  assertStringIncludes(src, 'if (allTime) await db.from("app_config").update({ value: "false" }).eq("key", "weekly_report_all_time");');
  // switched off only after the send succeeded
  assert(src.indexOf('update({ value: "false" }).eq("key", "weekly_report_all_time")') > src.indexOf("if (!resp.ok) {"));
});

Deno.test("drift: all-time starts at the very first order, even inside the week", async () => {
  const src = await Deno.readTextFile(new URL("../weekly-report/index.ts", import.meta.url));
  assertStringIncludes(src, "const from = first && first <= end ? first : start;");
});
