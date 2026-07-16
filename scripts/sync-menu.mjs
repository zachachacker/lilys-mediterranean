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
for (const cat of MENU) {
  for (const [name, desc, price, tag] of cat.items) {
    const id = slug(name);
    if (seen.has(id)) throw new Error(`duplicate slug: ${id}`);
    seen.add(id);
    // fixed prices only — ranges (e.g. wings "$12.99–$19.99") stay phone-order
    const m = /^\$(\d+)\.(\d{2})$/.exec(price);
    const orderable = Boolean(m);
    const cents = m ? Number(m[1]) * 100 + Number(m[2]) : 0;
    rows.push(
      `('${id}', '${esc(name)}', '${esc(desc)}', '${esc(cat.c)}', ${orderable ? cents : 1}, '${esc(tag)}', ${orderable})`
    );
  }
}

console.log(`-- generated from data.js — ${rows.length} items
insert into public.menu_items (id, name, description, category, price_cents, tag, orderable)
values
${rows.join(",\n")}
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  price_cents = excluded.price_cents,
  tag = excluded.tag,
  orderable = excluded.orderable;

-- retire items removed from data.js
delete from public.menu_items where id not in (
${[...seen].map((s) => `'${s}'`).join(", ")}
);`);
