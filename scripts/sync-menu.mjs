// Generates SQL that syncs public.menu_items from data.js (the site's single
// source of truth). Run after any menu/price change, then apply the SQL to
// Supabase (MCP execute_sql or the dashboard SQL editor):
//   node scripts/sync-menu.mjs > /tmp/menu-sync.sql
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, "data.js"), "utf8");

const window = {};
new Function("window", `${src}; return window;`)(window);
const MENU = window.LILYS.MENU;

const slug = (s) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) => String(s).replace(/'/g, "''");

const rows = [];
const seen = new Set();
// every item name the add-on map points at must exist, or the add-on silently vanishes
const allNames = new Set(MENU.flatMap((c) => c.items.map((i) => i[0])));
for (const n of Object.keys(window.LILYS.ADDONS.byItem)) if (!allNames.has(n)) throw new Error(`ADDONS.byItem names unknown dish: ${n}`);
const allCats = new Set(MENU.map((c) => c.c));
for (const c of Object.keys(window.LILYS.ADDONS.byCategory)) if (!allCats.has(c)) throw new Error(`ADDONS.byCategory names unknown category: ${c}`);

for (const cat of MENU) {
  for (const [name, desc, price, tag] of cat.items) {
    const id = slug(name);
    if (seen.has(id)) throw new Error(`duplicate slug: ${id}`);
    seen.add(id);
    // fixed prices only — ranges (e.g. wings "$12.99–$19.99") stay phone-order.
    // data.js holds IN-HOUSE prices; the server charges the ONLINE price (+3%).
    const m = /^\$(\d+)\.(\d{2})$/.exec(price);
    const orderable = Boolean(m);
    const cents = m ? window.LILYS.onlineCents(Number(m[1]) * 100 + Number(m[2])) : 0;
    const groups = window.LILYS.addonGroupsFor(cat.c, name);
    for (const g of groups) if (!window.LILYS.ADDONS.groups[g]) throw new Error(`unknown add-on group ${g} on ${name}`);
    const groupsSql = `'{${groups.join(",")}}'::text[]`;
    rows.push(
      `('${id}', '${esc(name)}', '${esc(desc)}', '${esc(cat.c)}', ${orderable ? cents : 1}, '${esc(tag)}', ${orderable}, ${groupsSql})`
    );
  }
}

console.log(`-- generated from data.js — ${rows.length} items
insert into public.menu_items (id, name, description, category, price_cents, tag, orderable, addon_groups)
values
${rows.join(",\n")}
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  price_cents = excluded.price_cents,
  tag = excluded.tag,
  orderable = excluded.orderable,
  addon_groups = excluded.addon_groups;

-- retire items removed from data.js
delete from public.menu_items where id not in (
${[...seen].map((s) => `'${s}'`).join(", ")}
);`);

// ── add-ons ──────────────────────────────────────────────────────────────
// `available` is the kitchen's 86 switch, so a re-sync never resets it.
const groupRows = [];
const optRows = [];
const optSeen = new Set();
Object.entries(window.LILYS.ADDONS.groups).forEach(([gid, g], gi) => {
  if (!/^[a-z0-9-]+$/.test(gid)) throw new Error(`bad group id ${gid}`);
  groupRows.push(`('${gid}', '${esc(g.label)}', ${g.max}, ${gi})`);
  g.options.forEach(([oid, label, price], oi) => {
    if (!/^[a-z0-9-]+$/.test(oid) || optSeen.has(oid)) throw new Error(`bad or duplicate add-on id ${oid}`);
    optSeen.add(oid);
    const m = /^\$(\d+)\.(\d{2})$/.exec(price);
    if (!m) throw new Error(`add-on ${oid} needs a fixed price`);
    const cents = window.LILYS.onlineCents(Number(m[1]) * 100 + Number(m[2]));
    optRows.push(`('${oid}', '${gid}', '${esc(label)}', ${cents}, ${oi})`);
  });
});
console.log(`
insert into public.addon_groups (id, label, max_select, sort)
values
${groupRows.join(",\n")}
on conflict (id) do update set label = excluded.label, max_select = excluded.max_select, sort = excluded.sort;

insert into public.addon_options (id, group_id, name, price_cents, sort)
values
${optRows.join(",\n")}
on conflict (id) do update set group_id = excluded.group_id, name = excluded.name,
  price_cents = excluded.price_cents, sort = excluded.sort;

delete from public.addon_options where id not in (${[...optSeen].map((s) => `'${s}'`).join(", ")});
delete from public.addon_groups where id not in (${Object.keys(window.LILYS.ADDONS.groups).map((s) => `'${s}'`).join(", ")});`);
