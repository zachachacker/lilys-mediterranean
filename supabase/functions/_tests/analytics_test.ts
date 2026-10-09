/* Order source + anonymous repeat-customer fingerprint (2026-10-08). */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { customerHash, normSource, phoneDigits } from "./mirrors.ts";

const src = () => Deno.readTextFile(new URL("../create-checkout/index.ts", import.meta.url));

Deno.test("drift: analytics helpers match the mirrors", async () => {
  const s = await src();
  assertStringIncludes(s, "function normSource(raw: unknown, max = 40): string | null {");
  assertStringIncludes(s, 'const s = String(raw ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, max);');
  assertStringIncludes(s, 'return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; // +1 US prefix');
  assertStringIncludes(s, "if (!salt || digits.length < 10) return null;");
  assertStringIncludes(s, "new TextEncoder().encode(`${salt}:${digits}`)");
  assertStringIncludes(s, 'const custHash = await customerHash(cfg.customer_hash_salt ?? "", phone);');
});

Deno.test("source: lowercased, junk stripped, capped, blank is null", () => {
  assertEquals(normSource("Google-Ads"), "google-ads");
  assertEquals(normSource("instagram<script>"), "instagramscript");
  assertEquals(normSource("a".repeat(60))?.length, 40);
  assertEquals(normSource(""), null);
  assertEquals(normSource(undefined), null);
  assertEquals(normSource("!!!"), null);
});

Deno.test("phone: the same number written three ways is one customer", () => {
  assertEquals(phoneDigits("(321) 555-0100"), "3215550100");
  assertEquals(phoneDigits("+1 321 555 0100"), "3215550100");
  assertEquals(phoneDigits("1-321-555-0100"), "3215550100");
});

Deno.test("fingerprint: stable per number, differs by number and by salt, never the number itself", async () => {
  const a = await customerHash("salt-one", "(321) 555-0100");
  const b = await customerHash("salt-one", "+1 321 555 0100");
  const c = await customerHash("salt-one", "(321) 555-0101");
  const d = await customerHash("salt-two", "(321) 555-0100");
  assertEquals(a, b);
  assertNotEquals(a, c);
  assertNotEquals(a, d);
  assert(a && a.length === 64 && !a.includes("3215550100"));
  assertEquals(await customerHash("", "(321) 555-0100"), null);
  assertEquals(await customerHash("salt", "555-0100"), null);
});
