/* Lily's Club (2026-10-10): the offer emails must stay legal and kind to the
 * list: unsubscribe in every email, the restaurant's address, members only,
 * a send gap, and the welcome gift once per email address ever. */
import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { whenText } from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, root));

Deno.test("offer emails: unsubscribe + address in every email, members only, 3-day gap", async () => {
  const g = await read("manage-api/index.ts");
  assertStringIncludes(g, 'headers: { "List-Unsubscribe": `<${m.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },');
  assertStringIncludes(g, "2 5th Ave STE C, Indialantic, FL 32903");
  assertStringIncludes(g, '.not("confirmed_at", "is", null).is("unsubscribed_at", null);');
  assertStringIncludes(g, "const SEND_GAP_DAYS = 3;");
  // recorded before sending, so a retry can't double-send
  assert(g.indexOf('from("deal_sends").insert(') < g.indexOf("emails/batch"));
});

Deno.test("welcome: one gift per address ever, unsubscribe in the email, consent kept", async () => {
  const d = await read("deals/index.ts");
  assertStringIncludes(d, "if (!sub.welcome_token) {");
  assertStringIncludes(d, '"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"');
  assertStringIncludes(d, "2 5th Ave STE C, Indialantic, FL 32903");
  // a GET (link scanners) never unsubscribes by itself
  assertStringIncludes(d, 'if (req.method === "GET") return Response.redirect(`${SITE}/club.html#u=${encodeURIComponent(u)}`, 302);');
  const w = await read("stripe-webhook/index.ts");
  assertStringIncludes(w, "if (to === \"paid\" && o.offers_opt_in && o.customer_email) {");
  assertStringIncludes(w, "consent_text: OFFERS_CONSENT");
});

Deno.test("offer email schedule wording", () => {
  assertStringIncludes(whenText({ days: [1, 2, 3, 4, 5], start_min: 660, end_min: 900, ends_at: null }), "Monday to Friday, 11am to 3pm");
  assertStringIncludes(whenText({ days: null, start_min: null, end_min: null, ends_at: null }), "every day.");
  assertStringIncludes(whenText({ days: [0, 6], start_min: null, end_min: null, ends_at: null }), "weekends");
});
