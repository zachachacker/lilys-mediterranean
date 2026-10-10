// Print sheets of Uber Eats bag stickers, every one with its OWN one-use QR.
// No typed code anywhere: coupon sites (Honey, Coupert) harvest typed codes,
// but a sticker's token only works once, and only on a first online order.
//
//   node scripts/make-stickers.mjs --count 48 --batch ubereats-1 --percent 5 \
//        --qrlib "$TMPDIR/qrgen/node_modules/qrcode"
//
// Writes, into private/ (gitignored, so never published on the site):
//   stickers-<batch>.html  print sheet, Avery 22806 layout (2in squares, 12 per Letter page)
//   stickers-<batch>.sql   the tokens: apply it BEFORE the stickers go out, or they won't scan
// Then print the HTML to PDF (Chrome: Print > Save as PDF, margins None, scale 100%).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const count = Number(arg("count", "48"));
const batch = arg("batch", "");
const percent = Number(arg("percent", "5"));
const qrlib = arg("qrlib", "");
if (!/^[a-z0-9-]{3,40}$/.test(batch)) throw new Error("--batch: 3-40 chars, a-z 0-9 -");
if (!(count > 0 && count <= 600)) throw new Error("--count: 1..600");
if (!(percent >= 1 && percent <= 50)) throw new Error("--percent: 1..50");
if (!qrlib) throw new Error("--qrlib: path to the npm 'qrcode' package (install it outside the repo)");
const QR = createRequire(import.meta.url)(qrlib);

// same alphabet and length the server accepts (create-checkout TOKEN_RE)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const token = () => [...randomBytes(10)].map((b) => ALPHABET[b % 30]).join("");
const tokens = new Set();
while (tokens.size < count) tokens.add(token());

const url = (t) => `https://lilysmediterraneanfresh.com/order.html?src=sticker#t=${t}`;
const svgs = await Promise.all([...tokens].map((t) =>
  QR.toString(url(t), { type: "svg", errorCorrectionLevel: "Q", margin: 2, color: { dark: "#000000", light: "#ffffff" } })));

const cells = [...tokens].map((t, i) => `
  <div class="st">
    <div class="top"><b>${percent}% off</b><span>your first order direct</span></div>
    <div class="qr">${svgs[i]}</div>
    <div class="bot">Scan · skip the app fees<br><i>lilysmediterraneanfresh.com</i></div>
  </div>`);
const pages = [];
for (let i = 0; i < cells.length; i += 12) pages.push(`<section class="page">${cells.slice(i, i + 12).join("")}</section>`);

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Lily's stickers · ${batch}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,400..700,0..100&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  /* Avery 22806: 2in x 2in squares, 3 across, 4 down; 0.625in margins, 2.5in pitch */
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "Fraunces", Georgia, serif; color: #1A1E1C; }
  .page { width: 8.5in; height: 11in; padding: 0.625in 0 0 0.625in; display: grid;
    grid-template-columns: repeat(3, 2in); grid-auto-rows: 2in; column-gap: 0.5in; row-gap: 0.5in;
    break-after: page; }
  .st { width: 2in; height: 2in; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: 0.1in 0.08in 0.09in; text-align: center; overflow: hidden; outline: 0.5pt dashed #cfcfcf; }
  .top b { display: block; font-size: 17pt; line-height: 1; color: #14532b; font-weight: 700; font-variation-settings: "opsz" 72; }
  .top span { display: block; font-size: 7.4pt; margin-top: 1pt; }
  .qr { width: 1.08in; height: 1.08in; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .bot { font-family: "Space Mono", monospace; font-size: 5.6pt; line-height: 1.35; letter-spacing: 0.02em; }
  .bot i { font-style: normal; font-weight: 700; }
  @media print { .st { outline: none; } }
</style></head>
<body>${pages.join("\n")}</body></html>`;

const sql = `-- ${count} sticker tokens, batch ${batch}, ${percent}% off a first online order. Apply before printing.
insert into public.promo_tokens (token, kind, percent, batch) values
${[...tokens].map((t) => `('${t}', 'sticker', ${percent}, '${batch}')`).join(",\n")};
`;

const out = join(dirname(dirname(fileURLToPath(import.meta.url))), "private");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `stickers-${batch}.html`), html);
writeFileSync(join(out, `stickers-${batch}.sql`), sql);
console.log(`${count} stickers (${pages.length} sheets) -> private/stickers-${batch}.html + .sql`);
