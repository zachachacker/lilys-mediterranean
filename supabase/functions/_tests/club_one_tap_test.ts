/* One-tap Club join on the order-confirmed page (2026-10-19). */
import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("consent: the words on the button's page are the words stored as proof", async () => {
  const deals = await read("../deals/index.ts");
  const page = await read("../../../order.js");
  const m = deals.match(/const CONFIRM_CONSENT = "([^"]+)";/);
  assert(m, "CONFIRM_CONSENT missing");
  assertStringIncludes(page, m[1]);
});

Deno.test("join_order: the order's own email, never re-joins someone who is on the list or left it", async () => {
  const deals = await read("../deals/index.ts");
  assertStringIncludes(deals, '.select("id,customer_email").eq("stripe_session_id", sid).maybeSingle();');
  assertStringIncludes(deals, 'const { data: have } = await db.from("subscribers").select("email").eq("email", em).maybeSingle();\n    if (have) return done;');
  assertStringIncludes(deals, 'source: "checkout", order_id: o.id, consent_text: CONFIRM_CONSENT');
  // no email typed in: the request body's email is not used by this action
  const branch = deals.slice(deals.indexOf('if (body.action === "join_order")'), deals.indexOf('if (body.action === "join") {'));
  assert(!branch.includes("body.email"));
  assert(!/welcome\(db, email,|"email", email\)/.test(branch), "join_order must use the order's email (em), not the typed one");
});

Deno.test("order-status: offers the join without ever returning the email", async () => {
  const s = await read("../order-status/index.ts");
  // the email, the customer hash and the raw discounts all stay on the server
  // (and since 2026-10-22 the phone too: only their SHA-256 hashes go out, for Google Ads)
  assertStringIncludes(s, "const { id, customer_hash, customer_email, customer_phone, discounts, ...order } = data;");
  assertStringIncludes(s, "if (em && !data.demo) {");
  assertStringIncludes(s, "referral: await referralFor(db, data), club, loyalty: await loyaltyFor(db, data) },");
  assertStringIncludes(s, "ads_user: await adsUserData(customer_email, customer_phone),");
});
