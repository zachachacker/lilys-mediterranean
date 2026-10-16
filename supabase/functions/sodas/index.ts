// The canned sodas Kareem stocks for the lunch wrap meals (2026-10-16). He
// ticks them on sodas.html; this saves them as the add-on options of the
// "lunch-soda" group, which the order page reads live, so the website
// updates the moment he saves: no code change, no deploy, nobody's laptop.
// The group becomes a required choice once it has at least one soda.
// Auth: the token in his link (app_config soda_form_token). It can only
// change this one list.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const GROUP = "lunch-soda";
// Zachary's phone (the same ntfy topic as the DNS watcher)
const NTFY = "https://ntfy.sh/lilys-dns-50bdd28cb2a9";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// names as typed or ticked -> a clean, de-duplicated list with stable ids
function cleanSodas(raw: unknown): { id: string; name: string }[] | null {
  if (!Array.isArray(raw) || raw.length > 15) return null;
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") return null;
    const name = r.replace(/[<>"]/g, "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > 40) return null;
    const slug = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ id: `${GROUP}-${slug}`.slice(0, 60), name });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { token?: string; sodas?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: t } = await db.from("app_config").select("value").eq("key", "soda_form_token").maybeSingle();
  const expected = (t?.value ?? "").trim();
  if (expected.length < 20 || !timingSafeEqual(String(body.token ?? ""), expected)) {
    await new Promise((r) => setTimeout(r, 1000));
    return json({ error: "This link isn't valid. Ask Zachary for a new one." }, 401);
  }
  const sodas = cleanSodas(body.sodas);
  if (!sodas) return json({ error: "Please tick up to 15 sodas, each name under 40 letters." }, 400);

  const ids = sodas.map((s) => s.id);
  const del = db.from("addon_options").delete().eq("group_id", GROUP);
  const { error: dErr } = ids.length ? await del.not("id", "in", `(${ids.join(",")})`) : await del;
  const { error: uErr } = sodas.length
    ? await db.from("addon_options").upsert(sodas.map((s, i) => ({ id: s.id, group_id: GROUP, name: s.name, price_cents: 0, sort: i })))
    : { error: null };
  const { error: gErr } = await db.from("addon_groups").update({ min_select: sodas.length ? 1 : 0 }).eq("id", GROUP);
  if (dErr || uErr || gErr) {
    console.error("sodas save failed:", dErr?.message ?? uErr?.message ?? gErr?.message);
    return json({ error: "Couldn't save just now. Please try again." }, 503);
  }

  const list = sodas.map((s) => s.name).join(", ") || "none";
  await fetch(NTFY, {
    method: "POST", body: `Kareem set the lunch sodas: ${list}. Live on the order page now.`,
    headers: { Title: "Lily's: lunch sodas updated", Tags: "cup_with_straw" },
  }).catch((e) => console.error("ntfy failed:", e));
  return json({ ok: true, sodas: sodas.map((s) => s.name) });
});
