/* Guards the mirrors in mirrors.ts against silent divergence from the real
 * Edge Function sources. Each case asserts an exact substring is still present
 * in the deployed source file. If a handler is edited without updating the
 * mirror, these fail — which is the point: every other test in this suite is
 * only meaningful while the mirrors are faithful.
 */
import { assertStringIncludes, assert } from "jsr:@std/assert@1";

const root = new URL("../", import.meta.url);
const read = async (p: string) => await Deno.readTextFile(new URL(p, root));

Deno.test("drift: stripe-webhook timingSafeEqual is unchanged", async () => {
  const src = await read("stripe-webhook/index.ts");
  assertStringIncludes(
    src,
    `function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}`,
  );
});

Deno.test("drift: stripe-webhook verifySignature is unchanged", async () => {
  const src = await read("stripe-webhook/index.ts");
  assertStringIncludes(src, `const pairs = header.split(",").map((kv) => kv.split("=") as [string, string]);`);
  assertStringIncludes(src, `if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;`);
  assertStringIncludes(src, `return v1s.some((v) => timingSafeEqual(expected, enc.encode(v)));`);
});

Deno.test("drift: square-webhook signature helpers are unchanged", async () => {
  const src = await read("square-webhook/index.ts");
  assertStringIncludes(
    src,
    `function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;`,
  );
  assertStringIncludes(
    src,
    `const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(notificationUrl + body));`,
  );
  assertStringIncludes(src, `return btoa(String.fromCharCode(...new Uint8Array(sig)));`);
});

Deno.test("drift: kitchen-api ALLOWED_FROM is unchanged", async () => {
  const src = await read("kitchen-api/index.ts");
  assertStringIncludes(
    src,
    `const ALLOWED_FROM: Record<string, string[]> = {
  paid: ["making"],                   // undo "start making"
  making: ["paid", "ready", "done"],  // advance, undo "ready", or recall a bumped ticket
  ready: ["making", "done"],          // advance, or undo "picked up"
  done: ["ready"],
  canceled: ["paid", "making", "ready"],
};`,
  );
});

Deno.test("drift: kitchen-api uses ALLOWED_FROM[to] as the FROM-set", async () => {
  // The whole state-machine test rests on this indexing direction.
  const src = await read("kitchen-api/index.ts");
  assertStringIncludes(src, `const from = ALLOWED_FROM[to];`);
  assertStringIncludes(src, `.in("status", from)`);
});

Deno.test("drift: create-checkout code generator is unchanged", async () => {
  const src = await read("create-checkout/index.ts");
  assertStringIncludes(src, `const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";`);
  assertStringIncludes(src, `function makeCode(len = 4, prefix = "LM"): string {`);
  assertStringIncludes(src, `for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];`);
  assertStringIncludes(src, "return `${prefix}-${s}`;");
});

Deno.test("drift: create-checkout closed-day test bypass is unchanged", async () => {
  const src = await read("create-checkout/index.ts");
  assertStringIncludes(src, `const notesRaw = (body.notes ?? "").trim().slice(0, 500);`);
  assertStringIncludes(src, `const testMatch = notesRaw.match(/^#test:(\\S+)\\s*/);`);
  assertStringIncludes(src, `const testTokenProvided = testMatch ? testMatch[1] : "";`);
  assertStringIncludes(
    src,
    `const notes = (testMatch ? notesRaw.slice(testMatch[0].length).trim() : notesRaw) || null;`,
  );
  assertStringIncludes(src, `const testOrderToken = (cfg.test_order_token ?? "").trim();`);
  assertStringIncludes(
    src,
    `const testOrder = !demo && testOrderToken.length > 0 && testTokenProvided.length > 0 &&
    timingSafeEqual(testTokenProvided, testOrderToken);`,
  );
  assertStringIncludes(src, `if (!demo && !testOrder && !openNow()) {`);
  assertStringIncludes(src, "code: makeCode(attempt < 2 ? 4 : 5, testOrder ? \"TEST\" : \"LM\"),");
  assertStringIncludes(src, "notes: testOrder ? `[SYSTEM TEST ORDER] ${notes ?? \"\"}`.trim() : notes,");
  // the compare helper create-checkout carries must stay byte-identical to the family
  assertStringIncludes(
    src,
    `function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;`,
  );
});

Deno.test("drift: order.js carries NO bypass plumbing — the secret rides only the notes text (B-4)", async () => {
  // order.js legitimately reads ?sid= and ?canceled= — the ban is on the
  // bypass secret specifically, not on query strings in general.
  const repo = new URL("../../", root);
  const orderJs = await Deno.readTextFile(new URL("order.js", repo));
  assert(!orderJs.includes("test_token"), "order.js must not name a test_token field");
  assert(!orderJs.includes(`get("test")`), "order.js must not read a test secret from the URL");
});

Deno.test("drift: create-checkout validation block is unchanged", async () => {
  const src = await read("create-checkout/index.ts");
  assertStringIncludes(src, `if (name.length < 2) return json({ error: "Please tell us your name for pickup." }, 400);`);
  assertStringIncludes(src, `if (phone.replace(/\\D/g, "").length < 10)`);
  assertStringIncludes(src, `if (items.length > 40)`);
  assertStringIncludes(
    src,
    `if (typeof line.id !== "string" || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 20) {`,
  );
  assertStringIncludes(src, `if (new Set(keys).size !== keys.length)`);
  assertStringIncludes(src, `(!Array.isArray(line.opts) || line.opts.length > 20 || line.opts.some((o) => typeof o !== "string"))) {`);
});

Deno.test("drift: create-checkout provider/demo decision is unchanged", async () => {
  const src = await read("create-checkout/index.ts");
  assertStringIncludes(
    src,
    `const squareSigKey = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") || cfg.square_webhook_signature_key || "";`,
  );
  assertStringIncludes(src, `const squareReady = Boolean(squareToken && squareLocation && squareSigKey);`);
  assertStringIncludes(src, `if (wanted === "square" && !squareReady) {`);
  assertStringIncludes(src, `if (wanted === "stripe" && !stripeKey) {`);
  assertStringIncludes(src, `if (wanted && wanted !== "square" && wanted !== "stripe") {`);
  assertStringIncludes(
    src,
    `const provider = wanted === "square" && squareReady ? "square"
    : wanted === "stripe" && stripeKey ? "stripe"
    : squareReady ? "square"
    : stripeKey ? "stripe"
    : "";`,
  );
  assertStringIncludes(src, `const demo = !provider;`);
  assertStringIncludes(src, `status: demo ? "paid" : "pending",`);
});

Deno.test("drift: escaping helpers in client JS are unchanged", async () => {
  const repo = new URL("../../", root);
  const orderJs = await Deno.readTextFile(new URL("order.js", repo));
  const kitchenJs = await Deno.readTextFile(new URL("kitchen.js", repo));
  const chatJs = await Deno.readTextFile(new URL("chat.js", repo));

  assertStringIncludes(
    orderJs,
    `const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");`,
  );
  assertStringIncludes(
    kitchenJs,
    `const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");`,
  );
  assertStringIncludes(kitchenJs, `const telHref = (s) => "tel:" + String(s ?? "").replace(/[^+\\d]/g, "");`);
  assertStringIncludes(
    chatJs,
    `const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");`,
  );
});

Deno.test("drift: order.js still interpolates l.qty WITHOUT esc()", async () => {
  // Documents a known-latent finding (SINK-06). If this ever starts failing,
  // someone fixed it — update the sink audit in SECURITY_TEST_PLAN.md.
  const repo = new URL("../../", root);
  const orderJs = await Deno.readTextFile(new URL("order.js", repo));
  assertStringIncludes(orderJs, "<span>${l.qty} × ${esc(l.name)}${l.addons?.length");
});

Deno.test("drift: main.js still interpolates menu name/desc WITHOUT esc()", async () => {
  // Documents SINK-13. data.js is developer-authored, so this is latent, not live.
  const repo = new URL("../../", root);
  const mainJs = await Deno.readTextFile(new URL("main.js", repo));
  assert(
    mainJs.includes('<span class="mi-name">${n}${tag'),
    "main.js:163 no longer interpolates raw ${n} — re-check the sink audit",
  );
  assertStringIncludes(mainJs, '<span class="mi-desc">${d}</span>');
});

Deno.test("drift: create-checkout promotions engine is unchanged", async () => {
  const src = await read("create-checkout/index.ts");
  // the two lines that decide money: order of application, and the ceiling
  assertStringIncludes(src, "const afterItem = Math.max(0, subtotal - discount);");
  assertStringIncludes(src, "discount = Math.min(discount, subtotal);");
  // tax must be charged on the discounted amount
  assertStringIncludes(src, "const tax = Math.round((subtotal - discount) * taxRate);");
});
