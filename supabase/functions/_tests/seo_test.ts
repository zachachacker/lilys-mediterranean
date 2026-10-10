/* SEO pins (2026-10-10). The restaurant card Google reads (index.html JSON-LD)
 * repeats the opening hours from data.js, and sitemap.xml lists the indexable
 * pages by hand. Both drift silently, so these tests make the drift loud. */
import { assertEquals } from "jsr:@std/assert@1";

const repo = new URL("../../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, repo));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

Deno.test("seo: JSON-LD opening hours match data.js HOURS", async () => {
  const dataJs = await read("data.js");
  const m = /HOURS:\s*(\{[^}]*\})/.exec(dataJs);
  if (!m) throw new Error("HOURS not found in data.js");
  const hours: Record<string, [number, number] | null> = JSON.parse(m[1].replace(/(\d+):/g, '"$1":'));
  const expected = DAYS.map((d, i) => hours[i] ? `${d} ${hhmm(hours[i]![0])}-${hhmm(hours[i]![1])}` : `${d} closed`);

  const html = await read("index.html");
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
  const open = new Map<string, string>();
  for (const s of ld.openingHoursSpecification) for (const d of s.dayOfWeek) open.set(d, `${s.opens}-${s.closes}`);
  const actual = DAYS.map((d) => open.has(d) ? `${d} ${open.get(d)}` : `${d} closed`);
  assertEquals(actual, expected);
});

Deno.test("seo: sitemap lists exactly the indexable pages", async () => {
  const pages: string[] = [];
  for await (const e of Deno.readDir(repo)) {
    if (!e.isFile || !e.name.endsWith(".html")) continue;
    const html = await read(e.name);
    if (!/name="robots" content="noindex/.test(html)) pages.push(e.name === "index.html" ? "" : e.name);
  }
  const sitemap = await read("sitemap.xml");
  const listed = [...sitemap.matchAll(/<loc>https:\/\/lilysmediterraneanfresh\.com\/([^<]*)<\/loc>/g)].map((m) => m[1]);
  assertEquals(listed.sort(), pages.sort());
});

Deno.test("seo: menu.html JSON-LD is current with data.js (run node scripts/menu-jsonld.mjs)", async () => {
  const { menuJsonLd, START, END } = await import("../../../scripts/menu-jsonld-lib.mjs");
  const html = await read("menu.html");
  const block = html.slice(html.indexOf(START), html.indexOf(END));
  const inPage = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(block)![1];
  assertEquals(inPage, menuJsonLd(await read("data.js")));
  // every dish is in it with its online price
  const ld = JSON.parse(inPage);
  const items = ld.hasMenuSection.flatMap((s: { hasMenuItem: unknown[] }) => s.hasMenuItem);
  assertEquals(items.length > 50, true);
});
