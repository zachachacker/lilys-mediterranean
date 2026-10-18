/* Catering enquiry form (2026-10-19): validation and the store-first rule. */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { validateCatering } from "./mirrors.ts";

const START = "// --- validateCatering: mirrored byte-for-byte in _tests/mirrors.ts ---";
const END = "// --- end validateCatering ---";

Deno.test("drift: validateCatering matches the mirror verbatim", async () => {
  const src = await Deno.readTextFile(new URL("../catering-enquiry/index.ts", import.meta.url));
  const mirror = await Deno.readTextFile(new URL("./mirrors.ts", import.meta.url));
  const a = src.indexOf(START);
  assertStringIncludes(mirror, src.slice(a, src.indexOf(END, a) + END.length));
});

Deno.test("drift: stored before any email; test rows send nothing; bots told ok", async () => {
  const s = await Deno.readTextFile(new URL("../catering-enquiry/index.ts", import.meta.url));
  assert(s.indexOf('.from("catering_enquiries").insert(') < s.indexOf("await sendEmail("));
  assertStringIncludes(s, "if (v.test) return json({ ok: true, test: true });");
  assertStringIncludes(s, "if (!v.ok) return v.bot ? json({ ok: true }) : json({ error: v.error }, 400);");
});

const TODAY = "2026-10-19";
const good = {
  name: "Maria  Lopez", phone: "+1 (321) 555-0142", email: "Maria@Example.com", company: "Space Coast Dental",
  event_date: "2026-10-30", guests: 40, fulfilment: "Delivery", notes: "Office lunch, 5 vegetarians", source: "Google-Ads",
};

Deno.test("a good enquiry is cleaned up", () => {
  const v = validateCatering(good, TODAY);
  assert(v.ok);
  assertEquals(v.row, {
    name: "Maria Lopez", phone: "(321) 555-0142", email: "maria@example.com", company: "Space Coast Dental",
    event_date: "2026-10-30", guests: 40, fulfilment: "Delivery", notes: "Office lunch, 5 vegetarians", source: "google-ads",
  });
  assertEquals(v.test, false);
});

Deno.test("optional fields can be blank; guests may arrive as text", () => {
  const v = validateCatering({ ...good, email: "", company: "", notes: "", source: "", guests: "25" }, TODAY);
  assert(v.ok);
  assertEquals([v.row.email, v.row.company, v.row.notes, v.row.source, v.row.guests], [null, null, null, null, 25]);
});

Deno.test("refuses what Kareem can't act on, with a message a person understands", () => {
  const bad = (patch: Record<string, unknown>) => {
    const v = validateCatering({ ...good, ...patch }, TODAY);
    return v.ok ? "ok" : v.error;
  };
  assertEquals(bad({ name: "M" }), "Please tell us your name.");
  assertEquals(bad({ phone: "555-0142" }), "Please enter a 10-digit US phone number.");
  assertEquals(bad({ email: "not-an-email" }), "That email address doesn't look right. You can also leave it blank.");
  assertEquals(bad({ event_date: "" }), "Please pick the date of your event.");
  assertEquals(bad({ event_date: "2026-02-30" }), "Please pick the date of your event.");
  assertEquals(bad({ event_date: "2026-10-18" }), "Please pick a date from today to a year ahead.");
  assertEquals(bad({ event_date: "2027-10-21" }), "Please pick a date from today to a year ahead.");
  assertEquals(bad({ event_date: TODAY }), "ok"); // same-day is allowed; the email flags it
  assertEquals(bad({ guests: 4 }), "Please enter how many people, from 5 to 2000.");
  assertEquals(bad({ guests: 12.5 }), "Please enter how many people, from 5 to 2000.");
  assertEquals(bad({ fulfilment: "Drone" }), "Please choose pickup or delivery.");
  assertEquals(bad({ notes: "x".repeat(1501) }), "Please keep your message to 1500 characters or fewer.");
});

Deno.test("honeypot and the TEST switch", () => {
  const bot = validateCatering({ ...good, website: "http://spam" }, TODAY);
  assert(!bot.ok && bot.bot);
  const t = validateCatering({ ...good, name: "TEST Zach", test: true }, TODAY);
  assert(t.ok && t.test);
  const notTest = validateCatering({ ...good, test: true }, TODAY); // only names starting "TEST "
  assert(notTest.ok && !notTest.test);
});
