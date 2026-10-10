// Print sheets of Uber Eats bag stickers, every one with its OWN one-use QR.
// No typed code anywhere: coupon sites (Honey, Coupert) harvest typed codes,
// but a sticker's token only works once, and only on a first online order.
//
// Three designs for an A/B/C test (Zachary, 2026-10-10). Each design is its own
// batch in promo_tokens (e.g. ubereats-1-a), so the dashboard can compare scans
// and orders per design; reprint more of whichever wins.
//   a  brand coupon: Lily's wordmark, gold "5% OFF" seal, "Skip the app fees."
//   b  food photo:  "Loved it? Skip the app next time." (the favourite going in)
//   c  money first: "Same food. Less money."
//
// New stickers (prints a .sql to apply BEFORE they go out, or they won't scan):
//   node scripts/make-stickers.mjs --design b --batch ubereats-2-b --count 24 \
//        --qrlib "$TMPDIR/qrgen/node_modules/qrcode"
// Reprint stickers already in the database (no new SQL):
//   node scripts/make-stickers.mjs --design b --batch ubereats-1-b \
//        --tokens-from private/stickers-ubereats-1-b.sql --qrlib ...
//
// Writes into private/ (gitignored, never published): stickers-<batch>.html
// (Avery 22806: 2in squares, 12 per Letter page) and, for new tokens, .sql.
// Print the HTML to PDF: Chrome, margins None, scale 100%.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const design = arg("design", "");
const count = Number(arg("count", "24"));
const batch = arg("batch", "");
const percent = Number(arg("percent", "5"));
const qrlib = arg("qrlib", "");
const tokensFrom = arg("tokens-from", "");
if (!["a", "b", "c"].includes(design)) throw new Error("--design: a, b or c");
if (!/^[a-z0-9-]{3,40}$/.test(batch)) throw new Error("--batch: 3-40 chars, a-z 0-9 -");
if (!tokensFrom && !(count > 0 && count <= 600)) throw new Error("--count: 1..600");
if (!(percent >= 1 && percent <= 50)) throw new Error("--percent: 1..50");
if (!qrlib) throw new Error("--qrlib: path to the npm 'qrcode' package (install it outside the repo)");
const QR = createRequire(import.meta.url)(qrlib);

// same alphabet and length the server accepts (create-checkout TOKEN_RE)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const token = () => [...randomBytes(10)].map((b) => ALPHABET[b % 30]).join("");
const tokens = new Set();
if (tokensFrom) {
  for (const m of readFileSync(tokensFrom, "utf8").matchAll(/\('([23456789ABCDEFGHJKMNPQRSTVWXYZ]{10})', 'sticker'/g)) tokens.add(m[1]);
  if (!tokens.size) throw new Error(`no sticker tokens found in ${tokensFrom}`);
} else {
  while (tokens.size < count) tokens.add(token());
}

const url = (t) => `https://lilysmediterraneanfresh.com/order.html?src=sticker#t=${t}`;
const svgs = await Promise.all([...tokens].map((t) =>
  QR.toString(url(t), { type: "svg", errorCorrectionLevel: "Q", margin: 1, color: { dark: "#000000", light: "#ffffff" } })));

// the bottom half B and C share: QR left, ONE big "5% off" right
const offer = (svg, sub) => `
    <div class="qr">${svg}</div>
    <div class="txt"><div class="big"><b>${percent}%</b><span>off</span></div>
      <div class="sub">${sub}</div><div class="cta">SCAN TO ORDER</div></div>`;

const CELL = {
  a: (svg) => `
  <div class="st a">
    <div class="brand">Lily<em>'s</em></div><div class="tiles"></div>
    <div class="qrw">${svg}</div>
    <div class="seal"><div><b>${percent}%</b><span>OFF</span></div></div>
    <div class="side">your first order direct</div>
    <div class="foot">Skip the app fees. <i>Scan to order.</i></div>
  </div>`,
  b: (svg) => `
  <div class="st b">
    <div class="ph"></div>
    <div class="head">Loved it? <em>Skip the app</em> next time.</div>${offer(svg, "your first order direct")}
  </div>`,
  c: (svg) => `
  <div class="st c">
    <div class="band"></div>
    <div class="head">Same food.<br><em>Less money.</em></div>${offer(svg, "order direct, no app fees")}
  </div>`,
};

const CSS = {
  a: `
  .a { background: #14532b; color: #F4F1E8; box-shadow: 0 0 0 0.04in #14532b; }
  .a .brand { position: absolute; top: 0.09in; left: 0; right: 0; text-align: center; font-family: "Fraunces", serif; font-weight: 700; font-size: 15pt; line-height: 1; font-variation-settings: "opsz" 72, "SOFT" 30; }
  .a .brand em { color: #E4A72E; font-style: italic; font-variation-settings: "opsz" 72, "SOFT" 50, "WONK" 1; }
  .a .tiles { position: absolute; top: 0.36in; left: -0.04in; right: -0.04in; height: 6pt;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='7' viewBox='0 0 56 14'%3E%3Cg fill='none' stroke='%23E4A72E' stroke-width='1.6' opacity='0.8'%3E%3Cpath d='M7 0 L14 7 L7 14 L0 7 Z'/%3E%3Cpath d='M21 0 L28 7 L21 14 L14 7 Z'/%3E%3Cpath d='M35 0 L42 7 L35 14 L28 7 Z'/%3E%3Cpath d='M49 0 L56 7 L49 14 L42 7 Z'/%3E%3C/g%3E%3C/svg%3E") repeat-x center; }
  .a .qrw { position: absolute; left: 0.13in; top: 0.52in; width: 0.98in; height: 0.98in; background: #fff; border-radius: 0.06in; padding: 0.03in; }
  .a .qrw svg { width: 100%; height: 100%; display: block; }
  .a .seal { position: absolute; right: 0.08in; top: 0.5in; width: 0.78in; height: 0.78in; border-radius: 50%; background: #E4A72E; color: #14532b;
    display: grid; place-items: center; text-align: center; transform: rotate(8deg); box-shadow: 0 0 0 2.5pt #14532b, 0 0 0 3.5pt #E4A72E; }
  .a .seal b { display: block; font-family: "Fraunces", serif; font-weight: 900; font-size: 22pt; line-height: 0.85; font-variation-settings: "opsz" 72; }
  .a .seal span { display: block; font: 800 7.5pt "Public Sans", sans-serif; letter-spacing: 0.08em; }
  .a .side { position: absolute; right: 0.06in; top: 1.34in; width: 0.84in; text-align: center; font: 600 6.6pt/1.25 "Public Sans", sans-serif; }
  .a .foot { position: absolute; bottom: 0.1in; left: 0; right: 0; text-align: center; font: 700 7.6pt "Public Sans", sans-serif; }
  .a .foot i { font-style: normal; color: #E4A72E; }`,
  b: `
  .b .ph { position: absolute; left: -0.04in; right: -0.04in; top: -0.04in; height: 0.96in; background: url(sticker-photo.jpg) center 55% / cover; }
  .b .ph:after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(14,58,74,0) 35%, rgba(20,83,43,0.92)); }
  .b .head { top: 0.5in; }`,
  c: `
  .c .band { position: absolute; left: -0.04in; right: -0.04in; top: -0.04in; height: 0.96in; background: #B4472B; }
  .c .head { top: 0.16in; font-size: 19pt; line-height: 0.98; }
  .c .head em { color: #F9D27B; }
  .c .big { color: #14532b; }`,
};

const cells = [...tokens].map((t, i) => CELL[design](svgs[i]));
const pages = [];
for (let i = 0; i < cells.length; i += 12) pages.push(`<section class="page">${cells.slice(i, i + 12).join("")}</section>`);

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Lily's stickers · ${batch} (design ${design.toUpperCase()})</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,400..900,0..100,0..1;1,9..144,400..900,0..100,0..1&family=Space+Mono:wght@700&family=Public+Sans:wght@600;800&display=swap" rel="stylesheet">
<style>
  /* Avery 22806: 2in x 2in squares, 3 across, 4 down; 0.625in margins, 2.5in pitch.
     Backgrounds bleed 0.04in past the cut line, so a slightly misaligned
     printer never leaves a white sliver on the edge. */
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "Public Sans", sans-serif; color: #1A1E1C; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 8.5in; height: 11in; padding: 0.625in 0 0 0.625in; display: grid;
    grid-template-columns: repeat(3, 2in); grid-auto-rows: 2in; column-gap: 0.5in; row-gap: 0.5in;
    break-after: page; }
  .st { width: 2in; height: 2in; position: relative; background: #F4F1E8; box-shadow: 0 0 0 0.04in #F4F1E8; }
  .head { position: absolute; left: 0.1in; right: 0.1in; z-index: 1; color: #F4F1E8;
    font-family: "Fraunces", serif; font-weight: 800; font-size: 13pt; line-height: 1; font-variation-settings: "opsz" 72, "SOFT" 20; }
  .head em { color: #E4A72E; font-style: italic; }
  .qr { position: absolute; left: 0.1in; bottom: 0.1in; width: 0.92in; height: 0.92in; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .txt { position: absolute; left: 1.07in; right: 0.06in; top: 0.98in; bottom: 0.09in; display: flex; flex-direction: column; justify-content: center; }
  .big { font-family: "Fraunces", serif; font-weight: 900; color: #B4472B; line-height: 0.8; font-variation-settings: "opsz" 144, "SOFT" 0; }
  .big b { font-size: 34pt; letter-spacing: -0.02em; }
  .big span { display: block; font-size: 19pt; margin-top: 1pt; letter-spacing: 0.01em; }
  .sub { font: 600 6.2pt/1.2 "Public Sans", sans-serif; margin-top: 4pt; }
  .cta { font: 700 5.6pt "Space Mono", monospace; color: #1F5A5F; margin-top: 3pt; }
  ${CSS[design]}
  @media screen { .st { outline: 0.5pt dashed #bbb; } }
</style></head>
<body>${pages.join("\n")}</body></html>`;

const sql = `-- ${tokens.size} sticker tokens, batch ${batch} (design ${design}), ${percent}% off a first online order. Apply before printing.
insert into public.promo_tokens (token, kind, percent, batch) values
${[...tokens].map((t) => `('${t}', 'sticker', ${percent}, '${batch}')`).join(",\n")};
`;

const out = join(dirname(dirname(fileURLToPath(import.meta.url))), "private");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `stickers-${batch}.html`), html);
if (!tokensFrom) writeFileSync(join(out, `stickers-${batch}.sql`), sql);
if (design === "b") copyFileSync(join(dirname(out), "print", "sticker-photo.jpg"), join(out, "sticker-photo.jpg"));
console.log(`${tokens.size} stickers, design ${design.toUpperCase()} (${pages.length} sheets) -> private/stickers-${batch}.html${tokensFrom ? " (existing tokens)" : " + .sql"}`);
