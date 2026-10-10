// Rewrites the menu JSON-LD block in menu.html from data.js. Run after any
// menu or price change (seo_test.ts fails until you do):
//   node scripts/menu-jsonld.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { menuJsonLd, START, END } from "./menu-jsonld-lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = join(root, "menu.html");
const html = readFileSync(page, "utf8");
const block = `${START}\n<script type="application/ld+json">${menuJsonLd(readFileSync(join(root, "data.js"), "utf8"))}</script>\n${END}`;
const re = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END}`);
const out = re.test(html) ? html.replace(re, () => block) : html.replace("</head>", () => `${block}\n</head>`);
writeFileSync(page, out);
console.log(`menu.html: ${(block.length / 1024).toFixed(1)} KB of menu JSON-LD`);
