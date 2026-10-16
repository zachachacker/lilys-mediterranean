/* Job applications from careers.html (2026-10-16). The validator is the only
 * thing between the public form and Kareem's inbox, so it is mirrored
 * byte-for-byte and tested here; the handler's ordering rules (store before
 * email, honeypot looks like success, TEST skips email) are pinned by drift. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { AVAILABILITY, LIMITS, POSITIONS, validateApplication } from "./mirrors.ts";

const root = new URL("../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, root));
const START = "// --- validateApplication: mirrored byte-for-byte in _tests/mirrors.ts ---";
const END = "// --- end validateApplication ---";
const block = (src: string) => {
  const i = src.indexOf(START), j = src.indexOf(END);
  if (i < 0 || j < i) throw new Error("validateApplication markers not found");
  return src.slice(i, j + END.length);
};

Deno.test("drift: validateApplication mirror is byte-identical to apply/index.ts", async () => {
  assertEquals(block(await read("_tests/mirrors.ts")), block(await read("apply/index.ts")));
});

Deno.test("drift: apply stores before emailing, bots get a fake ok, TEST skips email, 3 per day", async () => {
  const s = await read("apply/index.ts");
  assertStringIncludes(s, "if (!v.ok) return v.bot ? json({ ok: true }) : json({ error: v.error }, 400);");
  assertStringIncludes(s, "const MAX_PER_DAY = 3;");
  assertStringIncludes(s, "if (!error && (count ?? 0) >= MAX_PER_DAY) {");
  assertStringIncludes(s, "if (v.test) return json({ ok: true, test: true });");
  assert(s.indexOf('from("job_applications").insert(') < s.indexOf("await sendEmail("), "insert must come before any email");
  assert(s.indexOf("if (v.test) return") < s.indexOf("await sendEmail("), "TEST must return before sending");
  // every answer in Kareem's email is escaped
  for (const f of ["a.name", "a.phone", "a.email", "a.experience", "a.notes"]) assertStringIncludes(s, `esc(${f})`);
  assertStringIncludes(s, 'from: "Lily\'s Website <orders@lilysmediterraneanfresh.com>"');
});

const TODAY = "2026-10-16";
const good = (over: Record<string, unknown> = {}) => ({
  name: "Maria Santos", phone: "(321) 555-0123", email: "", positions: ["Line Cook"], availability: ["Mon", "Evenings"],
  start_date: "", experience: "", notes: "", over_16: true, website: "", ...over,
});
const err = (b: Record<string, unknown>) => {
  const r = validateApplication(b, TODAY);
  if (r.ok) throw new Error("expected a refusal");
  return r.error;
};

Deno.test("apply: a minimal good application is cleaned and accepted", () => {
  const r = validateApplication(good({ name: "  Maria   Santos ", phone: "+1 321-555-0123", positions: ["Prep Cook", "Line Cook", "Line Cook"] }), TODAY);
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.test, false);
  assertEquals(r.row, {
    name: "Maria Santos", phone: "(321) 555-0123", email: null, positions: ["Line Cook", "Prep Cook"], availability: ["Mon", "Evenings"],
    start_date: null, experience: null, notes: null, over_16: true,
  });
});

Deno.test("apply: required fields", () => {
  assertStringIncludes(err(good({ name: "" })), "name");
  assertStringIncludes(err(good({ name: "A" })), "name");
  assertStringIncludes(err(good({ phone: "" })), "phone");
  assertStringIncludes(err(good({ positions: [] })), "at least one job");
  assertStringIncludes(err(good({ positions: undefined })), "from the list");
  assertStringIncludes(err(good({ availability: [] })), "at least one day");
  assertStringIncludes(err(good({ over_16: undefined })), "16 or older");
  assertStringIncludes(err(good({ over_16: "yes" })), "16 or older");
  // "no" is an answer, not a refusal: Kareem decides
  const r = validateApplication(good({ over_16: false }), TODAY);
  assert(r.ok && r.row.over_16 === false);
});

Deno.test("apply: bad phone numbers", () => {
  for (const p of ["555-0123", "321555012", "32155501234", "1234567890", "(021) 555-0123", "321 155 0123", "phone", 3215550123]) {
    assertStringIncludes(err(good({ phone: p })), "10-digit US phone");
  }
  const r = validateApplication(good({ phone: "1 (321) 555 0123" }), TODAY);
  assert(r.ok && r.row.phone === "(321) 555-0123");
});

Deno.test("apply: only listed positions and availability", () => {
  assertStringIncludes(err(good({ positions: ["Manager"] })), "job from the list");
  assertStringIncludes(err(good({ positions: ["Line Cook", "<script>"] })), "job from the list");
  assertStringIncludes(err(good({ positions: "Line Cook" })), "job from the list");
  assertStringIncludes(err(good({ positions: [1] })), "job from the list");
  assertStringIncludes(err(good({ positions: Array(7).fill("Line Cook") })), "job from the list");
  assertStringIncludes(err(good({ availability: ["Wed"] })), "availability from the list");
  assertEquals(POSITIONS, ["Line Cook", "Prep Cook", "Cashier / Server"]);
  assert(!AVAILABILITY.includes("Wed"));
});

Deno.test("apply: length limits", () => {
  assertEquals(LIMITS, { name: 80, email: 254, experience: 1500, notes: 1000 });
  assert(validateApplication(good({ experience: "x".repeat(1500), notes: "y".repeat(1000) }), TODAY).ok);
  assertStringIncludes(err(good({ experience: "x".repeat(1501) })), "1500 characters");
  assertStringIncludes(err(good({ notes: "y".repeat(1001) })), "1000 characters");
  assertStringIncludes(err(good({ name: "N".repeat(81) })), "80 characters");
  assertStringIncludes(err(good({ email: `${"a".repeat(250)}@b.co` })), "email");
});

Deno.test("apply: email is optional but must look right", () => {
  const r = validateApplication(good({ email: " Maria@Example.COM " }), TODAY);
  assert(r.ok && r.row.email === "maria@example.com");
  for (const e of ["maria", "maria@", "maria@example", "a b@c.de"]) assertStringIncludes(err(good({ email: e })), "email");
});

Deno.test("apply: start date", () => {
  const ok = validateApplication(good({ start_date: "2026-10-20" }), TODAY);
  assert(ok.ok && ok.row.start_date === "2026-10-20");
  assert(validateApplication(good({ start_date: "2026-10-15" }), TODAY).ok); // a timezone's grace
  assertStringIncludes(err(good({ start_date: "2026-02-30" })), "doesn't look right");
  assertStringIncludes(err(good({ start_date: "20/10/2026" })), "doesn't look right");
  assertStringIncludes(err(good({ start_date: "2026-10-01" })), "within the next year");
  assertStringIncludes(err(good({ start_date: "2028-01-01" })), "within the next year");
});

Deno.test("apply: honeypot is a silent bot refusal", () => {
  const r = validateApplication(good({ website: "http://spam.example" }), TODAY);
  assert(!r.ok && r.bot === true);
  const missing = validateApplication(good({ website: undefined }), TODAY);
  assert(missing.ok, "a missing honeypot is fine; only a filled one is a bot");
});

Deno.test("apply: test flag only counts with a TEST name", () => {
  const t = validateApplication(good({ name: "TEST Zachary", test: true }), TODAY);
  assert(t.ok && t.test === true);
  const notTest = validateApplication(good({ name: "Maria Santos", test: true }), TODAY);
  assert(notTest.ok && notTest.test === false);
  const noFlag = validateApplication(good({ name: "TEST Zachary" }), TODAY);
  assert(noFlag.ok && noFlag.test === false);
  const truthy = validateApplication(good({ name: "TEST Zachary", test: "true" }), TODAY);
  assert(truthy.ok && truthy.test === false);
});
