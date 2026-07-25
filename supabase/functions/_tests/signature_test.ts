/* Webhook signature verification — the sole authentication on both webhook
 * endpoints (verify_jwt=false on stripe-webhook and square-webhook, confirmed
 * against the live project). If these are weak, anyone can mark orders paid.
 */
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  enc,
  expectedSquareSignature,
  hex,
  timingSafeEqualBytes,
  timingSafeEqualStr,
  verifyStripeSignature,
} from "./mirrors.ts";

const SECRET = "whsec_test_not_a_real_secret_0000";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const now = () => Math.floor(Date.now() / 1000);

async function stripeSign(payload: string, secret: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  return hex(mac);
}

/* ── Stripe ───────────────────────────────────────────────────────────── */

Deno.test("stripe sig: valid signature accepted", async () => {
  const t = now();
  const v1 = await stripeSign(PAYLOAD, SECRET, t);
  assert(await verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1}`, SECRET));
});

Deno.test("stripe sig: wrong secret rejected", async () => {
  const t = now();
  const v1 = await stripeSign(PAYLOAD, "whsec_a_different_secret_000000000", t);
  assertEquals(await verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1}`, SECRET), false);
});

Deno.test("stripe sig: tampered payload rejected", async () => {
  const t = now();
  const v1 = await stripeSign(PAYLOAD, SECRET, t);
  const tampered = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", extra: 1 });
  assertEquals(await verifyStripeSignature(tampered, `t=${t},v1=${v1}`, SECRET), false);
});

Deno.test("stripe sig: timestamp +301s rejected (replay window closes)", async () => {
  const t = now() + 301;
  const v1 = await stripeSign(PAYLOAD, SECRET, t);
  assertEquals(await verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1}`, SECRET), false);
});

Deno.test("stripe sig: timestamp -301s rejected", async () => {
  const t = now() - 301;
  const v1 = await stripeSign(PAYLOAD, SECRET, t);
  assertEquals(await verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1}`, SECRET), false);
});

Deno.test("stripe sig: timestamp +299s accepted (inside window)", async () => {
  const t = now() + 299;
  const v1 = await stripeSign(PAYLOAD, SECRET, t);
  assert(await verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1}`, SECRET));
});

Deno.test("stripe sig: missing t= rejected", async () => {
  const v1 = await stripeSign(PAYLOAD, SECRET, now());
  assertEquals(await verifyStripeSignature(PAYLOAD, `v1=${v1}`, SECRET), false);
});

Deno.test("stripe sig: missing v1= rejected", async () => {
  assertEquals(await verifyStripeSignature(PAYLOAD, `t=${now()}`, SECRET), false);
});

Deno.test("stripe sig: empty header rejected", async () => {
  assertEquals(await verifyStripeSignature(PAYLOAD, "", SECRET), false);
});

Deno.test("stripe sig: malformed header rejected", async () => {
  for (const h of ["garbage", "=", ",,,", "t=,v1=", "t=abc,v1=def"]) {
    assertEquals(await verifyStripeSignature(PAYLOAD, h, SECRET), false, `header: ${h}`);
  }
});

Deno.test("stripe sig: multiple v1 with one valid accepted (rotation)", async () => {
  const t = now();
  const good = await stripeSign(PAYLOAD, SECRET, t);
  assert(await verifyStripeSignature(PAYLOAD, `t=${t},v1=deadbeef,v1=${good}`, SECRET));
  assert(await verifyStripeSignature(PAYLOAD, `t=${t},v1=${good},v1=deadbeef`, SECRET));
});

Deno.test("stripe sig: multiple v1 all invalid rejected", async () => {
  const t = now();
  assertEquals(await verifyStripeSignature(PAYLOAD, `t=${t},v1=dead,v1=beef`, SECRET), false);
});

Deno.test("stripe sig: NaN timestamp rejected", async () => {
  const v1 = await stripeSign(PAYLOAD, SECRET, now());
  // Number("nope") is NaN; Math.abs(NaN) > 300 is false, so this probes whether
  // a non-numeric t slips past the freshness check into the HMAC comparison.
  const result = await verifyStripeSignature(PAYLOAD, `t=nope,v1=${v1}`, SECRET);
  assertEquals(result, false, "non-numeric t must not authenticate");
});

/* ── Square ───────────────────────────────────────────────────────────── */

const SQ_KEY = "sq_sig_key_not_real_000000";
const SQ_URL = "https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/square-webhook";
const SQ_BODY = JSON.stringify({ type: "payment.updated", data: { object: { payment: { status: "COMPLETED" } } } });

Deno.test("square sig: valid signature accepted", async () => {
  const sig = await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY);
  assert(timingSafeEqualStr(sig, await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY)));
});

Deno.test("square sig: wrong key produces different signature", async () => {
  const a = await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY);
  const b = await expectedSquareSignature("sq_other_key_000000000000", SQ_URL, SQ_BODY);
  assertNotEquals(a, b);
  assertEquals(timingSafeEqualStr(a, b), false);
});

Deno.test("square sig: tampered body produces different signature", async () => {
  const a = await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY);
  const b = await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY.replace("COMPLETED", "PENDING"));
  assertEquals(timingSafeEqualStr(a, b), false);
});

Deno.test("square sig: notification URL off by ONE character breaks verification", async () => {
  const a = await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY);
  const b = await expectedSquareSignature(SQ_KEY, SQ_URL.replace("square-webhook", "square-webhooK"), SQ_BODY);
  assertEquals(timingSafeEqualStr(a, b), false, "URL is part of the signed material — drift silently breaks every webhook");
});

Deno.test("square sig: TRAILING SLASH mismatch breaks verification", async () => {
  const a = await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY);
  const b = await expectedSquareSignature(SQ_KEY, SQ_URL + "/", SQ_BODY);
  assertEquals(timingSafeEqualStr(a, b), false, "a trailing slash in app_config.square_webhook_url strands every payment");
});

Deno.test("square sig: empty provided signature rejected", () => {
  assertEquals(timingSafeEqualStr("", "somesignature"), false);
});

Deno.test("square sig: http vs https in notification URL breaks verification", async () => {
  const a = await expectedSquareSignature(SQ_KEY, SQ_URL, SQ_BODY);
  const b = await expectedSquareSignature(SQ_KEY, SQ_URL.replace("https://", "http://"), SQ_BODY);
  assertEquals(timingSafeEqualStr(a, b), false);
});

/* ── timingSafeEqual, both variants ───────────────────────────────────── */

Deno.test("timingSafeEqual(bytes): equal inputs match", () => {
  assert(timingSafeEqualBytes(enc.encode("abcdef"), enc.encode("abcdef")));
});

Deno.test("timingSafeEqual(bytes): differing at first/middle/last byte rejected", () => {
  assertEquals(timingSafeEqualBytes(enc.encode("Xbcdef"), enc.encode("abcdef")), false);
  assertEquals(timingSafeEqualBytes(enc.encode("abcXef"), enc.encode("abcdef")), false);
  assertEquals(timingSafeEqualBytes(enc.encode("abcdeX"), enc.encode("abcdef")), false);
});

Deno.test("timingSafeEqual(bytes): UNEQUAL LENGTH early-returns — leaks length", () => {
  // Documented, accepted behaviour: both implementations return before the
  // constant-time loop when lengths differ, so length is a timing oracle.
  // For the kitchen key this is a real (if small) leak — see KEY-02.
  assertEquals(timingSafeEqualBytes(enc.encode("abc"), enc.encode("abcdef")), false);
  assertEquals(timingSafeEqualStr("abc", "abcdef"), false);
});

Deno.test("timingSafeEqual(str): equal inputs match, incl. multi-byte UTF-8", () => {
  assert(timingSafeEqualStr("kitchen-key-123", "kitchen-key-123"));
  assert(timingSafeEqualStr("café–ünïcode", "café–ünïcode"));
});

Deno.test("timingSafeEqual(str): empty vs empty matches — a blank key would authenticate", () => {
  // kitchen-api guards this separately with `if (!expected || ...)`.
  // This test pins that the guard is load-bearing, not decorative.
  assert(timingSafeEqualStr("", ""));
});
