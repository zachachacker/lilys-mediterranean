// Emails Kareem (app_config notify_email) his private links: the offers page
// and the kitchen screen (2026-10-10). Private links never go on WhatsApp or
// on an update page. Optional PDF attachments (e.g. sticker print files, which
// hold single-use discount codes and so are never published).
// Auth: header x-send-token must equal app_config owner_email_token, which is
// deleted on use, so every send needs a fresh token set by hand.
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SITE = "https://lilysmediterraneanfresh.com";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = req.headers.get("x-send-token") ?? "";
  if (token.length < 32) return json({ error: "forbidden" }, 403);
  // one use: only the call that deletes the matching token goes on
  const { data: used } = await db.from("app_config").delete().eq("key", "owner_email_token").eq("value", token).select("key");
  if (!used?.length) return json({ error: "forbidden" }, 403);

  let body: { attachments?: { filename: string; content: string }[] };
  try { body = await req.json(); } catch { body = {}; }
  const attachments = (body.attachments ?? []).filter((a) => /^[\w.-]+\.pdf$/.test(a.filename) && typeof a.content === "string");

  const { data: config } = await db.from("app_config").select("key,value")
    .in("key", ["manager_key", "kitchen_key", "notify_email", "resend_api_key"]);
  const cfg = Object.fromEntries((config ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const apiKey = Deno.env.get("RESEND_API_KEY") || cfg.resend_api_key || "";
  if (!apiKey || !cfg.notify_email || !cfg.manager_key || !cfg.kitchen_key) return json({ error: "not configured" }, 503);

  const offers = `${SITE}/manage.html#key=${cfg.manager_key}`;
  const kitchen = `${SITE}/kitchen.html#key=${cfg.kitchen_key}`;
  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:#B4472B;color:#fff;text-decoration:none;font-weight:700;font-size:17px;padding:12px 22px;border-radius:99px">${label}</a>`;
  const stickers = attachments.length
    ? `<h2 style="font-size:19px;margin:26px 0 6px">3. Uber Eats bag stickers</h2>
       <p style="font-size:17px;line-height:1.5;margin:0">The ${attachments.length} sticker files are attached. Print them on Avery 22806 sticker sheets, or take them to a print shop.</p>`
    : "";

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1E1C;font-size:17px">
    <p style="line-height:1.5;margin:0 0 6px">Hi Kareem,</p>
    <p style="line-height:1.5;margin:0 0 4px">Here are your private links. Please don't share them.</p>
    <h2 style="font-size:19px;margin:22px 0 6px">1. Your offers page</h2>
    <p style="line-height:1.5;margin:0 0 10px">Make lunch specials and other deals, and turn them on or off.</p>
    ${btn(offers, "Open offers page")}
    <h2 style="font-size:19px;margin:26px 0 6px">2. Kitchen screen</h2>
    <p style="line-height:1.5;margin:0 0 10px">See online orders on your phone, the same as the kitchen tablet.</p>
    ${btn(kitchen, "Open kitchen screen")}
    ${stickers}
    <p style="line-height:1.5;margin:26px 0 0">Tip: open each link on your phone, tap Share, then "Add to Home Screen". It will open like an app.</p>
    <p style="line-height:1.5;margin:18px 0 0">Claude, for Zachary</p>
  </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Lily's Mediterranean <orders@lilysmediterraneanfresh.com>",
      to: [cfg.notify_email],
      reply_to: "zachary@mr10x.com",
      subject: "Your private Lily's links",
      html,
      text: `Hi Kareem,\nHere are your private links. Please don't share them.\n\n1. Your offers page:\n${offers}\n\n2. Kitchen screen:\n${kitchen}\n${attachments.length ? `\n3. Uber Eats bag stickers: the files are attached. Print on Avery 22806 sticker sheets, or take them to a print shop.\n` : ""}\nClaude, for Zachary`,
      attachments: attachments.length ? attachments : undefined,
    }),
  });
  if (!resp.ok) {
    console.error("owner email failed:", resp.status, await resp.text().catch(() => ""));
    return json({ error: "send failed" }, 502);
  }
  return json({ ok: true, to: cfg.notify_email, attachments: attachments.map((a) => a.filename) });
});
