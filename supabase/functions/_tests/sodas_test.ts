/* Lunch sodas (2026-10-16): Kareem's ticked/typed list becomes the
 * "lunch-soda" add-on options. Names are cleaned, de-duplicated, bounded. */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { cleanSodas } from "./mirrors.ts";

const root = new URL("../", import.meta.url);

Deno.test("drift: cleanSodas mirror matches the sodas function", async () => {
  const s = await Deno.readTextFile(new URL("sodas/index.ts", root));
  const m = await Deno.readTextFile(new URL("_tests/mirrors.ts", root));
  const body = (t: string) => t.slice(t.indexOf("function cleanSodas"), t.indexOf("return out;\n}") + 13);
  assertEquals(body(m), body(s));
  assertStringIncludes(s, 'const GROUP = "lunch-soda";');
  // required only while it has sodas; never a required group with nothing to pick
  assertStringIncludes(s, 'update({ min_select: sodas.length ? 1 : 0 })');
});

Deno.test("sodas: ticked and typed names become stable ids", () => {
  assertEquals(cleanSodas(["Coca-Cola", " Diet  Coke ", "Dr Pepper"]), [
    { id: "lunch-soda-coca-cola", name: "Coca-Cola" },
    { id: "lunch-soda-diet-coke", name: "Diet Coke" },
    { id: "lunch-soda-dr-pepper", name: "Dr Pepper" },
  ]);
});

Deno.test("sodas: duplicates, blanks and markup are dropped", () => {
  assertEquals(cleanSodas(["Sprite", "sprite", "", "  ", "<b>Fanta</b>"]), [
    { id: "lunch-soda-sprite", name: "Sprite" },
    { id: "lunch-soda-bfanta-b", name: "bFanta/b" },
  ]);
});

Deno.test("sodas: bad input is refused, an empty list is allowed", () => {
  assertEquals(cleanSodas("Coke"), null);
  assertEquals(cleanSodas([1]), null);
  assertEquals(cleanSodas(["x".repeat(41)]), null);
  assertEquals(cleanSodas(Array(16).fill("Coke")), null);
  assertEquals(cleanSodas([]), []);
});
