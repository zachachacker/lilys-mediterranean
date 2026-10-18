/* Refer-a-friend link in the "order ready" email (2026-10-19). */
import { assertStringIncludes } from "jsr:@std/assert@1";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("the email's link is the one the order page reads, and the page's share link", async () => {
  const email = await read("../notify-ready/index.ts");
  const page = await read("../../../order.js");
  assertStringIncludes(email, "url: `${SITE}/order.html?src=referral#r=${have.token}`");
  assertStringIncludes(page, "`${location.origin}/order.html?src=referral#r=${r.token}`");
});

Deno.test("one link per customer, shared with the confirmation page; off unless referral_enabled", async () => {
  const email = await read("../notify-ready/index.ts");
  const status = await read("../order-status/index.ts");
  for (const s of [email, status]) {
    assertStringIncludes(s, '.eq("kind", "referral").eq("referrer_hash"');
    assertStringIncludes(s, '(c.referral_enabled ?? "").trim() !== "true"');
  }
  assertStringIncludes(email, 'if (demo || !hash || code.startsWith("TEST-")) return null;');
});
