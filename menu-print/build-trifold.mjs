/* Builds menu-trifold.html from menu-v4.html.
   ONE source of truth: the booklet is authored by hand, the trifold is
   generated from it. That is deliberate — David's trifold and his booklet were
   maintained separately and drifted, so the same dish carried two different
   prices on one flyer. Generating removes the possibility.

   Format is David's: A4 landscape (297 x 210mm), three 99mm panels a side,
   six panels, same panel allocation he used. Design is the V4 booklet's, so
   the two pieces read as one set.

   Run:  node menu-print/build-trifold.mjs && <chrome> --print-to-pdf ...
*/
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("./menu-v4.html", import.meta.url);
const OUT = new URL("./menu-trifold.html", import.meta.url);
const html = readFileSync(SRC, "utf8");
const body = html.slice(html.indexOf("<body>"));

const dec = (s) => s.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
const clean = (s) => dec(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/* ---- parse the booklet ------------------------------------------------- */
// Sections and items in document order. Sections that continue over a page
// break carry no second <h2>, so items attach to the last header seen.
const tok =
  /<h2>([\s\S]*?)<\/h2>|<div class="note">([\s\S]*?)<\/div>|<span class="sub">([\s\S]*?)<\/span>|<div class="item">([\s\S]*?)(?=<div class="item">|<div class="sec">|<div class="grp|<\/div>\s*<div class="trio|<div class="footer|<div class="findus|<div class="pageno)/g;

const sections = [];
let cur = null, m;
while ((m = tok.exec(body))) {
  if (m[1] !== undefined) { cur = { name: clean(m[1]), sub: "", note: "", items: [] }; sections.push(cur); continue; }
  if (!cur) continue;
  if (m[2] !== undefined) { if (!cur.note) cur.note = clean(m[2]); continue; }
  if (m[3] !== undefined) { if (!cur.sub) cur.sub = clean(m[3]); continue; }
  const blk = m[4];
  const nm = /<span class="nm">([\s\S]*?)<\/span>/.exec(blk);
  if (!nm) continue;
  const g = (re) => { const x = re.exec(blk); return x ? clean(x[1]) : ""; };
  cur.items.push({
    name: clean(nm[1]),
    price: g(/<span class="pr">([\s\S]*?)<\/span>/),
    desc: g(/<div class="ds">([\s\S]*?)<\/div>/),
    add: g(/<div class="add">([\s\S]*?)<\/div>/),
    tag: g(/<span class="tag">([\s\S]*?)<\/span>/),
    sig: /class="sig"/.test(blk),
  });
}

// merge sections split across a page break that DO repeat their header
const S = new Map();
for (const s of sections) {
  if (!s.items.length) continue;
  const prev = S.get(s.name);
  if (prev) { prev.items.push(...s.items); if (!prev.note) prev.note = s.note; }
  else S.set(s.name, s);
}
const sec = (n) => {
  const s = S.get(n);
  if (!s) throw new Error(`section not found in menu-v4.html: ${n}`);
  return s;
};

// the favourites list and the standing notes, lifted from the booklet
const favs = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => clean(x[1]));
const footer = clean(/<div class="footer">([\s\S]*?)<div class="line2">/.exec(body)[1]);
const catering = clean(/<div class="line2">([\s\S]*?)<\/div>/.exec(body)[1]);

/* ---- render ------------------------------------------------------------ */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const item = (it) => `
        <div class="i">
          <div class="ih">${it.sig ? '<span class="sig">✦</span>' : ""}<span class="n">${esc(it.name)}</span>${
            it.tag ? `<span class="t">${it.tag}</span>` : ""
          }<span class="dots"></span><span class="p">${it.price}</span></div>
          ${it.desc ? `<div class="d">${esc(it.desc)}</div>` : ""}
          ${it.add ? `<div class="a">${esc(it.add)}</div>` : ""}
        </div>`;

const block = (name, opts = {}) => {
  const s = sec(name);
  const title = opts.title ?? s.name;
  return `
      <section class="blk">
        <div class="hd"><h2>${esc(title)}</h2>${s.sub ? `<span class="sub">${esc(s.sub)}</span>` : ""}</div>
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}
        ${s.items.map(item).join("")}
      </section>`;
};

const page = (panels) => `<div class="sheet">${panels.map((p) => `<div class="panel">${p}</div>`).join("")}</div>`;

const coverPanel = `
      <div class="cover">
        <img class="logo" src="assets/logo.png" alt="Lily's Mediterranean Fresh Grill">
        <div class="eyebrow">Indialantic · Florida</div>
        <h1>Menu</h1>
        <img class="platter" src="assets/platter.png" alt="">
        <div class="tag-line">Authentic Mediterranean goodness, served fresh.</div>
        <div class="legend"><b>VEG</b> Vegetarian &nbsp; <b>VEGAN</b> Vegan &nbsp; <b>GF</b> Gluten-free &nbsp; <b>✦</b> Guest favourite</div>
      </div>`;

const contactPanel = `
      <section class="contact">
        <h3>Find us</h3>
        <p class="addr">2 5th Ave STE C<br>Indialantic, FL 32903</p>
        <p class="tel">(321) 312-4444</p>
        <p class="site">lilysmediterranean.com</p>
        <div class="hrs">
          <span><span>Mon, Tue &amp; Thu</span><span>11–10</span></span>
          <span><span>Friday &amp; Saturday</span><span>11–11</span></span>
          <span><span>Sunday</span><span>11–10</span></span>
          <span class="shut"><span>Closed Wednesdays</span><span></span></span>
        </div>
        <p class="fine">${esc(footer)}</p>
        <p class="fine i">${esc(catering)}</p>
      </section>`;

const favsBlock = `
      <section class="favs">
        <h2>Guest Favourites</h2>
        <div class="lead">Marked ✦ throughout</div>
        <ul>${favs.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </section>`;

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lily's Mediterranean — Trifold (A4 landscape)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Public+Sans:wght@300..700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  /* GENERATED by build-trifold.mjs from menu-v4.html — do not hand-edit.
     Edit the booklet, then re-run the build. */
  @page { size: 297mm 210mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; }

  :root {
    --forest:#14532b; --ember:#a8322a; --gold:#b8862f; --ink:#221f1a;
    --muted:#6a6459; --paper:#fbf5ea; --rule:rgba(34,31,26,0.16);
    --serif:"Fraunces",Georgia,serif; --sans:"Public Sans",Helvetica,Arial,sans-serif;
    --mono:"Space Mono",ui-monospace,monospace;
  }
  body { font-family:var(--sans); color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  .sheet {
    width:297mm; height:210mm; display:flex; page-break-after:always;
    position:relative; overflow:hidden; background:var(--paper);
  }
  .sheet:last-child { page-break-after:auto; }
  .sheet::before {
    content:""; position:absolute; inset:0; z-index:0;
    background-image:url("assets/marble.png"); background-size:cover; opacity:0.45;
  }
  /* three 99mm panels; the fold falls between them */
  .panel {
    width:99mm; height:210mm; padding:9mm 7mm 8mm; position:relative; z-index:1;
    display:flex; flex-direction:column; overflow:hidden;
  }
  /* no rule between panels: the fold is a crease, not ink. Guides here would
     print as visible dashed lines down the finished flyer. */

  /* ---------------------------------------------------------- sections */
  .blk { margin-bottom:3.3mm; }
  .blk:last-child { margin-bottom:0; }
  .hd { display:flex; align-items:baseline; gap:2mm; border-bottom:1.4pt solid var(--forest); padding-bottom:0.9mm; margin-bottom:1.5mm; }
  .hd h2 {
    font-family:var(--serif); font-weight:600; font-size:13.4pt; color:var(--forest);
    line-height:1; letter-spacing:-0.01em; font-variation-settings:"opsz" 60,"SOFT" 20;
  }
  .hd .sub { font-family:var(--mono); font-size:5.8pt; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-left:auto; white-space:nowrap; }
  .note { font-size:6.2pt; font-style:italic; color:var(--muted); line-height:1.3; margin-bottom:1.4mm; }

  /* ------------------------------------------------------------- items */
  .i { margin-bottom:1.45mm; break-inside:avoid; }
  .i:last-child { margin-bottom:0; }
  .ih { display:flex; align-items:baseline; gap:0; }
  .n { font-family:var(--serif); font-weight:600; font-size:8.4pt; color:var(--ink); line-height:1.12; font-variation-settings:"opsz" 30; }
  .sig { color:var(--gold); font-size:6.4pt; margin-right:0.7mm; }
  .t {
    font-family:var(--mono); font-size:5pt; font-weight:700; letter-spacing:0.06em;
    color:var(--forest); border:0.5pt solid rgba(20,83,43,0.42); border-radius:1pt;
    padding:0.3pt 1.6pt; margin-left:1mm; white-space:nowrap; position:relative; top:-0.3mm;
  }
  /* leader dots keep the eye on the line in a narrow panel */
  .dots { flex:1; margin:0 1.4mm; border-bottom:0.5pt dotted rgba(34,31,26,0.30); position:relative; top:-0.5mm; min-width:2mm; }
  .p { font-family:var(--mono); font-weight:700; font-size:7.4pt; color:var(--ember); white-space:nowrap; }
  .d { font-size:6.2pt; line-height:1.29; color:var(--muted); margin-top:0.25mm; }
  .a { font-size:5.8pt; font-style:italic; font-weight:600; color:var(--gold); margin-top:0.25mm; line-height:1.25; }

  /* --------------------------------------------------------- favourites */
  .favs { border:1pt solid var(--forest); border-radius:1.5pt; padding:2.6mm 3mm 2.8mm; margin-bottom:3.4mm; background:rgba(255,255,255,0.42); }
  .favs h2 { font-family:var(--serif); font-size:11pt; font-weight:600; color:var(--forest); line-height:1; }
  .favs .lead { font-family:var(--mono); font-size:4.8pt; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin:0.7mm 0 1.5mm; }
  .favs ul { list-style:none; padding:0; columns:2; column-gap:3mm; }
  .favs li { font-family:var(--serif); font-size:6.9pt; font-weight:500; line-height:1.45; break-inside:avoid; }
  .favs li::before { content:"✦"; color:var(--gold); margin-right:0.8mm; font-size:5.4pt; }

  /* -------------------------------------------------------------- cover */
  .cover { flex:1; display:flex; flex-direction:column; align-items:center; text-align:center; }
  .cover .logo { width:46mm; }
  .cover .eyebrow { font-family:var(--mono); font-size:5.6pt; letter-spacing:0.3em; text-transform:uppercase; color:var(--muted); margin-top:4mm; }
  .cover h1 {
    font-family:var(--serif); font-size:40pt; font-weight:500; color:var(--forest);
    letter-spacing:-0.02em; line-height:0.95; margin-top:1.5mm;
    font-variation-settings:"opsz" 144,"SOFT" 30;
  }
  .cover .platter { width:80mm; margin-top:2mm; }
  .cover .tag-line { font-family:var(--serif); font-style:italic; font-size:9.4pt; color:var(--ink); margin-top:auto; line-height:1.3; }
  .cover .legend {
    font-family:var(--mono); font-size:5pt; letter-spacing:0.06em; color:var(--muted);
    margin-top:2.4mm; padding-top:2mm; border-top:0.5pt solid var(--rule); width:100%; line-height:1.7;
  }
  .cover .legend b { color:var(--forest); }

  /* ------------------------------------------------------------ contact */
  .contact { margin-top:auto; padding-top:3mm; border-top:1.4pt solid var(--forest); }
  .contact h3 { font-family:var(--mono); font-size:5.2pt; letter-spacing:0.16em; text-transform:uppercase; color:var(--gold); margin-bottom:1.2mm; }
  .contact p { font-size:6.9pt; line-height:1.4; }
  .contact .tel { font-weight:700; font-size:7.4pt; margin-top:0.6mm; }
  .contact .site { font-family:var(--mono); font-size:6pt; color:var(--ember); margin-top:0.6mm; }
  .contact .hrs { display:flex; flex-direction:column; margin-top:1.6mm; }
  .contact .hrs > span { display:flex; justify-content:space-between; gap:2mm; font-size:6.5pt; line-height:1.45; }
  .contact .hrs > span > span:last-child { font-family:var(--mono); font-size:5.8pt; color:var(--muted); }
  .contact .hrs .shut { color:var(--ember); font-weight:600; }
  .contact .fine { font-size:5.9pt; line-height:1.3; color:var(--ember); font-weight:600; margin-top:2mm; }
  .contact .fine.i { color:var(--muted); font-weight:500; font-style:italic; margin-top:0.6mm; }
</style>
</head>
<body>

<!-- ============ SHEET 1 (outside): back panel | wraps | front cover ===== -->
${page([
  block("Quesadillas") + block("Kids") + block("Sides & Wings") + block("Desserts") + contactPanel,
  block("Wraps, Gyros & Subs") + block("Burgers"),
  coverPanel,
])}

<!-- ============ SHEET 2 (inside): mezze | salads+family | platters ====== -->
${page([
  favsBlock + block("Mezze & Starters") + block("From the Kitchen"),
  block("Salads & Soup") + block("Family Specials"),
  block("Lily's Platters") + block("Lily's Bowls"),
])}

</body>
</html>
`;

writeFileSync(OUT, out);
const n = [...S.values()].reduce((a, s) => a + s.items.length, 0);
console.log(`wrote menu-trifold.html — ${S.size} sections, ${n} items, ${favs.length} favourites`);
