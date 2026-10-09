/* Lily's — first-party, cookieless analytics (2026-10-08).
 *
 * Two jobs, both privacy-light:
 *  1. Remember where this visitor came from (an ad, Google, Instagram, a sticker
 *     QR, or typed in) so the order can record it. Last non-direct source wins,
 *     kept 30 days in this browser only.
 *  2. Count funnel steps (visits, add-to-cart, checkout) as DAILY TOTALS on the
 *     server. No visitor id, no cookie, no fingerprint is ever sent: just
 *     "one more add_to_cart for hummus today, from google".
 */
(() => {
  const L = window.LILYS;
  if (!L || !L.ORDERING) return;
  const STORE = "lilys-source-v1";
  const KEEP_MS = 30 * 86400 * 1000;
  const clean = (s, max = 40) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, max);

  function detect() {
    const q = new URLSearchParams(location.search);
    const explicit = q.get("src") || q.get("utm_source");
    if (explicit) return { source: clean(explicit), detail: clean(q.get("utm_campaign") || q.get("c"), 80) };
    if (q.get("gclid") || q.get("gbraid") || q.get("wbraid")) return { source: "google-ads", detail: clean(q.get("utm_campaign"), 80) };
    if (q.get("fbclid")) return { source: "facebook", detail: "" };
    let host = "";
    try { host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
    if (!host || host === location.hostname) return null; // direct or internal: keep what we had
    const map = [
      [/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/duckduckgo\.com$/, "duckduckgo"],
      [/instagram\.com$/, "instagram"], [/(facebook|fb)\.com$/, "facebook"], [/tiktok\.com$/, "tiktok"],
      [/yelp\.com$/, "yelp"], [/tripadvisor\./, "tripadvisor"], [/ubereats\.com$/, "ubereats"], [/doordash\.com$/, "doordash"],
      [/skytab\.com$/, "skytab"],
    ];
    for (const [re, name] of map) if (re.test(host)) return { source: name, detail: "" };
    return { source: clean(host.replace(/\./g, "-")), detail: "" };
  }

  function stored() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "null");
      return v && Date.now() - v.at < KEEP_MS ? v : null;
    } catch { return null; }
  }

  const fresh = detect();
  if (fresh && fresh.source) {
    try { localStorage.setItem(STORE, JSON.stringify({ ...fresh, at: Date.now() })); } catch { /* fine */ }
  }
  const current = () => (fresh && fresh.source ? fresh : stored()) || { source: "direct", detail: "" };

  function event(name, item = "") {
    if (navigator.webdriver) return; // headless crawlers and test robots
    try {
      fetch(`${L.ORDERING.supabaseUrl}/rest/v1/rpc/track_event`, {
        method: "POST", keepalive: true,
        headers: { apikey: L.ORDERING.anonKey, Authorization: `Bearer ${L.ORDERING.anonKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_event: name, p_item: item, p_source: current().source }),
      }).catch(() => {});
    } catch { /* analytics must never break the page */ }
  }

  // one visit per page per browser session, so refreshing doesn't inflate it
  const page = /order-confirmed/.test(location.pathname) ? ""
    : /order/.test(location.pathname) ? "visit_order"
    : /menu/.test(location.pathname) ? "visit_menu" : "visit_home";
  if (page) {
    let seen = false;
    try { seen = sessionStorage.getItem("lilys-seen-" + page) === "1"; sessionStorage.setItem("lilys-seen-" + page, "1"); } catch { /* fine */ }
    if (!seen) event(page);
  }

  window.LILYS_TRACK = { event, source: () => current().source, detail: () => current().detail || "" };
})();
