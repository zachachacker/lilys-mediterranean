/* Lily's kitchen board — polls kitchen-api every 5s, rings on new paid
   orders until acknowledged, advances status with one tap.
   Access key is typed once and kept in localStorage on the tablet. */
(() => {
  "use strict";
  const SUPABASE_URL = "https://hytvfqydahwsrcdbnvfq.supabase.co";
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5dHZmcXlkYWh3c3JjZGJudmZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDk3NDYsImV4cCI6MjA5OTc4NTc0Nn0.taAfp5xGFYdxyNxeszmxEt5Me-PPNfUbXfs4suLvXt0";
  const API = `${SUPABASE_URL}/functions/v1/kitchen-api`;
  const KEY_STORE = "lilys-kitchen-key";
  const SEEN_STORE = "lilys-kitchen-seen";
  const POLL_MS = 5000;

  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const telHref = (s) => "tel:" + String(s ?? "").replace(/[^+\d]/g, "");
  const money = (c) => `$${(c / 100).toFixed(2)}`;

  let key = localStorage.getItem(KEY_STORE) || "";
  let orders = [];
  let seen = new Set(JSON.parse(localStorage.getItem(SEEN_STORE) || "[]"));
  let pollTimer = 0;
  let lastFetchOk = true;

  /* ------------------------------------------------------------ sound ---- */
  let audioCtx = null;
  let ringTimer = 0;
  const ensureAudio = () => {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ }
    }
    if (audioCtx?.state === "suspended") audioCtx.resume();
  };
  const chime = () => {
    if (!audioCtx || audioCtx.state !== "running") return;
    const t0 = audioCtx.currentTime;
    [[880, 0], [1174.66, 0.18]].forEach(([f, dt]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.7);
    });
  };
  const soundReady = () => audioCtx?.state === "running";
  const startRinging = () => {
    if (ringTimer) return;
    chime();
    ringTimer = setInterval(chime, 2600);
  };
  const stopRinging = () => {
    clearInterval(ringTimer);
    ringTimer = 0;
  };

  /* -------------------------------------------------------------- api ---- */
  const call = async (payload) => {
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "x-kitchen-key": key,
      },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw Object.assign(new Error("Wrong kitchen key"), { auth: true });
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };

  const refresh = async () => {
    try {
      const { orders: list } = await call({ action: "list" });
      orders = list;
      lastFetchOk = true;
    } catch (e) {
      lastFetchOk = false;
      if (e.auth) {
        localStorage.removeItem(KEY_STORE);
        key = "";
        stopRinging();
        renderLogin(e.message);
        return;
      }
    }
    renderBoard();
  };

  const advance = async (id, to) => {
    try {
      await call({ action: "advance", id, to });
    } catch { /* refresh will resync */ }
    refresh();
  };

  /* ------------------------------------------------------------ views ---- */
  function renderLogin(err = "") {
    stopRinging();
    app.innerHTML = `
      <div class="k-login">
        <h1>Lily<em>'s</em> Kitchen</h1>
        <p>Enter the kitchen key to see live orders. You only do this once per tablet.</p>
        <input id="keyIn" type="password" placeholder="Kitchen key" autocomplete="off">
        <button id="keyGo">Open the board</button>
        ${err ? `<p class="k-err">${esc(err)}</p>` : ""}
      </div>`;
    const go = () => {
      key = document.getElementById("keyIn").value.trim();
      if (!key) return;
      localStorage.setItem(KEY_STORE, key);
      ensureAudio();
      app.innerHTML = `<div class="k-login"><p>Connecting…</p></div>`;
      refresh().then(() => { schedulePolling(); });
    };
    document.getElementById("keyGo").addEventListener("click", go);
    document.getElementById("keyIn").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  const age = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

  function card(o, action) {
    const items = (o.items || [])
      .map((l) => `<div class="k-item"><b>${l.qty}×</b><span>${esc(l.name)}</span></div>`)
      .join("");
    const mins = age(o.created_at);
    const fresh = o.status === "paid" && !seen.has(o.id);
    return `<div class="k-card${fresh ? " fresh" : ""}">
      <div class="k-card-top">
        <span class="k-code">${esc(o.code)}${o.demo ? '<span class="k-demo">test</span>' : ""}</span>
        <span class="k-age${mins >= 25 ? " late" : ""}">${mins}m</span>
      </div>
      <div class="k-cust">${esc(o.customer_name)} · <a href="${telHref(o.customer_phone)}">${esc(o.customer_phone)}</a></div>
      <div class="k-items">${items}</div>
      ${o.notes ? `<div class="k-notes">${esc(o.notes)}</div>` : ""}
      <div class="k-total">${money(o.total_cents)} paid online</div>
      <div class="k-actions">
        <button class="go" data-adv="${o.id}" data-to="${action.to}">${action.label}</button>
        <button class="x" data-adv="${o.id}" data-to="canceled" data-confirm="${esc(o.code)}" data-real="${o.demo ? "" : "1"}">Cancel</button>
      </div>
    </div>`;
  }

  let lastSnapshot = "";
  function renderBoard(force = false) {
    if (!key) return renderLogin();
    const paid = orders.filter((o) => o.status === "paid");
    const making = orders.filter((o) => o.status === "making");
    const ready = orders.filter((o) => o.status === "ready");
    const past = orders.filter((o) => ["done", "canceled"].includes(o.status)).reverse();

    const unseen = paid.filter((o) => !seen.has(o.id));
    if (unseen.length) startRinging(); else stopRinging();

    // don't rebuild the DOM under the cook's finger unless something changed;
    // the minute bucket keeps the "Nm" age labels ticking
    const snapshot = JSON.stringify([orders, [...seen], lastFetchOk, soundReady(), Math.floor(Date.now() / 60000)]);
    if (!force && snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    const doneWasOpen = document.querySelector(".k-done")?.open ?? false;

    const col = (title, list, action, cls) => `
      <div class="k-col ${cls}">
        <h2><span>${title}</span><span>${list.length || ""}</span></h2>
        <div class="k-cards">
          ${list.length ? list.map((o) => card(o, action)).join("") : '<div class="k-empty">Nothing here.</div>'}
        </div>
      </div>`;

    app.innerHTML = `
      <div class="k-head">
        <div>
          <div class="k-brand">Lily<em>'s</em> Kitchen</div>
          <div class="k-sub">Live orders · updates every 5s</div>
        </div>
        <div class="k-meta">
          <span><i class="k-dot${lastFetchOk ? "" : " err"}"></i> ${lastFetchOk ? "connected" : "reconnecting…"}</span>
          <button class="k-mute" id="testSound">${soundReady() ? "Test sound" : "🔕 Tap to enable sound"}</button>
        </div>
      </div>
      <div class="k-board">
        ${col("New", paid, { to: "making", label: "Start making" }, "k-col-new")}
        ${col("Making", making, { to: "ready", label: "Ready for pickup" }, "k-col-making")}
        ${col("Ready", ready, { to: "done", label: "Picked up" }, "k-col-ready")}
      </div>
      <details class="k-done"${doneWasOpen ? " open" : ""}>
        <summary>Earlier today (${past.length})</summary>
        ${past.map((o) => `<div class="k-done-line"><span>${esc(o.code)}</span><span class="st-${o.status}">${o.status}</span><span>${esc(o.customer_name)}</span><span>${money(o.total_cents)}</span></div>`).join("")}
      </details>
      ${unseen.length ? `<div class="k-ring"><span>${unseen.length === 1 ? "New order!" : unseen.length + " new orders!"}${soundReady() ? "" : " (tap anywhere to enable sound)"}</span><button id="ackBtn">Got it</button></div>` : ""}`;

    document.getElementById("testSound")?.addEventListener("click", () => { ensureAudio(); setTimeout(() => { chime(); renderBoard(true); }, 60); });
    document.getElementById("ackBtn")?.addEventListener("click", () => {
      paid.forEach((o) => seen.add(o.id));
      localStorage.setItem(SEEN_STORE, JSON.stringify([...seen].slice(-500)));
      stopRinging();
      renderBoard();
    });
    app.querySelectorAll("[data-adv]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.confirm) {
          const warn = b.dataset.real
            ? `Cancel order ${b.dataset.confirm}?\n\nHeads up: this does NOT refund the payment — issue the refund in the Stripe dashboard.`
            : `Cancel order ${b.dataset.confirm}?`;
          if (!confirm(warn)) return;
        }
        seen.add(b.dataset.adv);
        advance(b.dataset.adv, b.dataset.to);
      })
    );
  }

  function schedulePolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(refresh, POLL_MS);
  }

  // every tap is a chance to unlock audio (tablets suspend WebAudio until a
  // user gesture — including after every page reload with a stored key)
  document.addEventListener("pointerdown", () => {
    const wasReady = soundReady();
    ensureAudio();
    // resume() is async — recheck shortly and refresh the 🔕 indicator
    setTimeout(() => { if (soundReady() !== wasReady) renderBoard(true); }, 150);
  });

  if (key) {
    app.innerHTML = `<div class="k-login"><p>Connecting…</p></div>`;
    refresh().then(schedulePolling);
  } else {
    renderLogin();
  }
})();
