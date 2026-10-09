// One-tap rating after pickup (2026-10-08). The confirmation page sends the
// order's unguessable session id (the same key order-status uses), so only the
// customer holding that page can rate their own order, and only once it has
// actually been collected. One rating per order; a change of mind overwrites.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { sid?: string; rating?: number; comment?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const sid = String(body.sid ?? "");
  const rating = Number(body.rating);
  const comment = String(body.comment ?? "").trim().slice(0, 500) || null;
  if (!sid || sid.length > 200) return json({ error: "Missing order" }, 400);
  if (rating !== 1 && rating !== -1) return json({ error: "Bad rating" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: o, error } = await db.from("orders").select("id,code,status,demo").eq("stripe_session_id", sid).maybeSingle();
  if (error) return json({ error: "Temporarily unavailable" }, 503);
  if (!o) return json({ error: "Order not found" }, 404);
  if (o.status !== "done") return json({ error: "You can rate your order once you've collected it." }, 409);

  const { error: upErr } = await db.from("feedback").upsert(
    { order_id: o.id, code: o.code, rating, comment, created_at: new Date().toISOString() },
    { onConflict: "order_id" },
  );
  if (upErr) {
    console.error("feedback write failed:", upErr.message);
    return json({ error: "Temporarily unavailable" }, 503);
  }
  return json({ ok: true });
});
