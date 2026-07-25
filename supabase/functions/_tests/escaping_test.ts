/* The five hand-rolled esc() variants and telHref().
 *
 * There is no templating engine and no CSP anywhere in this project, so these
 * five functions are the entire XSS defence. Three of the five do not escape
 * quotes; this file pins exactly which, and in which HTML context each is
 * therefore unsafe.
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { escChat, escDaily, escKitchen, escNotify, escOrder, telHref } from "./mirrors.ts";

const VARIANTS = [
  { name: "order.js:18      esc", fn: escOrder as (s: string) => string, quotes: false },
  { name: "chat.js:14       esc", fn: escChat, quotes: false },
  { name: "kitchen.js:41    esc", fn: escKitchen as (s: string) => string, quotes: true },
  { name: "notify-order:11  esc", fn: escNotify, quotes: false },
  { name: "daily-summary:10 esc", fn: escDaily, quotes: false },
];

const PAYLOADS = [
  "<script>alert(1)</script>",
  '"',
  "'",
  "`",
  "&lt;",
  "\\",
  "\0",
  "javascript:alert(1)",
  '" onerror="alert(1)',
  "' onmouseover='alert(1)",
  "<img src=x onerror=alert(1)>",
  "</script><script>alert(1)</script>",
  "<script>",
  "<svg/onload=alert(1)>",
];

Deno.test("esc: every variant neutralises angle brackets and ampersands", () => {
  for (const { name, fn } of VARIANTS) {
    for (const p of PAYLOADS) {
      const out = fn(p);
      assert(!out.includes("<"), `${name} left a raw '<' for ${JSON.stringify(p)}`);
      assert(!out.includes(">"), `${name} left a raw '>' for ${JSON.stringify(p)}`);
    }
    assertEquals(fn("<script>"), "&lt;script&gt;", name);
    assertEquals(fn("&"), "&amp;", name);
  }
});

Deno.test("esc: FOUR OF FIVE variants leave quotes raw — unsafe in attribute context", () => {
  // NOTE: the brief (and SYSTEM_PROFILE §16 prose) said "three of the five".
  // Measured: FOUR leak quotes (order.js, chat.js, notify-order, daily-summary);
  // only kitchen.js:41 escapes both quote styles. Corrected here as ESC-02.
  const leaky: string[] = [];
  const safe: string[] = [];
  for (const { name, fn, quotes } of VARIANTS) {
    const dq = fn('"').includes('"');
    const sq = fn("'").includes("'");
    (dq || sq ? leaky : safe).push(name);
    assertEquals(!dq && !sq, quotes, `${name}: quote-escaping did not match the expected posture`);
  }
  console.log("\n  quote-safe (attribute context OK):\n    " + safe.join("\n    "));
  console.log("  quote-LEAKING (text context only):\n    " + leaky.join("\n    ") + "\n");
  assertEquals(leaky.length, 4, "four variants leak quotes, not three");
  assertEquals(safe.length, 1, "kitchen.js:41 is the only quote-safe variant");
});

Deno.test("esc: attribute breakout succeeds against the 3-char variants", () => {
  // Demonstrates why the 3-char variants must never be used inside an attribute.
  // No current call site does this — the finding is latent, and this test is the
  // tripwire if one ever appears.
  const payload = '" onerror="alert(1)';
  const built = `<img alt="${escOrder(payload)}">`;
  assertStringIncludes(built, 'onerror="alert(1)"', "order.js esc() does NOT survive attribute context");

  const safeBuilt = `<img alt="${escKitchen(payload)}">`;
  assert(!safeBuilt.includes('onerror="'), "kitchen.js esc() correctly neutralises the breakout");
  assertStringIncludes(safeBuilt, "&quot;");
});

Deno.test("esc: single-quoted attribute breakout also succeeds against 3-char variants", () => {
  const payload = "' onmouseover='alert(1)";
  assertStringIncludes(`<b title='${escOrder(payload)}'>`, "onmouseover='alert(1)'");
  assert(!`<b title='${escKitchen(payload)}'>`.includes("onmouseover='"));
});

Deno.test("esc: NONE of the variants defend a URL context", () => {
  // e.g. href="${esc(x)}" with x = javascript:… — angle brackets are irrelevant.
  for (const { name, fn } of VARIANTS) {
    assertEquals(fn("javascript:alert(1)"), "javascript:alert(1)", `${name} passes javascript: through unchanged`);
  }
});

Deno.test("esc: ampersand is escaped FIRST, so no double-encoding bug", () => {
  // Order matters: if & were replaced last, "&lt;" would become "&amp;lt;".
  for (const { name, fn } of VARIANTS) {
    assertEquals(fn("&lt;"), "&amp;lt;", name);
    assertEquals(fn("<"), "&lt;", name);
  }
});

Deno.test("esc: null bytes and backslashes pass through unchanged", () => {
  for (const { name, fn } of VARIANTS) {
    assertEquals(fn("\0"), "\0", name);
    assertEquals(fn("\\"), "\\", name);
  }
});

Deno.test("esc: only the kitchen and order variants tolerate non-string input", () => {
  // chat/notify/daily call s.replace() directly — a null or number throws.
  assertEquals(escKitchen(null as unknown as string), "");
  assertEquals(escKitchen(undefined as unknown as string), "");
  assertEquals(escOrder(null as unknown as string), "null");
  assertEquals(escOrder(123 as unknown as string), "123");

  for (const { name, fn } of [{ name: "chat", fn: escChat }, { name: "notify", fn: escNotify }, { name: "daily", fn: escDaily }]) {
    let threw = false;
    try { fn(null as unknown as string); } catch { threw = true; }
    assert(threw, `${name} esc() should throw on null (documents ESC-06)`);
  }
});

/* ── telHref — kitchen.js:42 ──────────────────────────────────────────── */

Deno.test("telHref: strips everything except + and digits", () => {
  assertEquals(telHref("(321) 312-4444"), "tel:+3213124444".replace("+", ""), "no plus in the input");
  assertEquals(telHref("+1 (321) 312-4444"), "tel:+13213124444");
});

Deno.test("telHref: neutralises injection through the phone field", () => {
  const attacks = [
    '"><script>alert(1)</script>',
    "javascript:alert(1)",
    "' onclick='alert(1)",
    "\" onmouseover=\"alert(1)",
    "tel:1234\" autofocus onfocus=\"alert(1)",
    "<img src=x onerror=alert(1)>",
  ];
  for (const a of attacks) {
    const out = telHref(a);
    assert(/^tel:[+\d]*$/.test(out), `telHref leaked: ${out}`);
    for (const ch of ['"', "'", "<", ">", " ", "(", ")", "=", ";", ":"]) {
      assert(!out.slice(4).includes(ch), `telHref left ${ch} in ${out}`);
    }
  }
});

Deno.test("telHref: a phone of only punctuation yields a bare 'tel:' — harmless but dead link", () => {
  assertEquals(telHref("abc-def"), "tel:");
  assertEquals(telHref(null), "tel:");
});

Deno.test("telHref: multiple + signs survive (malformed but inert)", () => {
  assertEquals(telHref("++1+2"), "tel:++1+2");
});
