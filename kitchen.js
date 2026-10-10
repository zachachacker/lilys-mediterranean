/* Lily's kitchen display — vendor-convention interaction model:
   tap a NEW ticket to start it (that IS the acknowledgement), one big READY
   button while making, PICKED UP on the ready rail, 5s undo after every bump,
   recall from history, cancel demoted to the ··· menu. Chimes on arrival and
   softly re-chimes while anything sits un-started; age colors the header band.
   Offline: keeps showing the last-known board, queues taps, replays on
   reconnect. Wake lock + fullscreen for all-day tablet duty.

   DOM contract: #kShell (header + banners) and #kUndoWrap (snackbar) update
   freely; #kBoard only rebuilds when order data changes, so the cook's
   mid-tap target never moves. Timers/age colors tick in place. */
(() => {
  "use strict";
  const SUPABASE_URL = "https://hytvfqydahwsrcdbnvfq.supabase.co";
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5dHZmcXlkYWh3c3JjZGJudmZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDk3NDYsImV4cCI6MjA5OTc4NTc0Nn0.taAfp5xGFYdxyNxeszmxEt5Me-PPNfUbXfs4suLvXt0";
  const API = `${SUPABASE_URL}/functions/v1/kitchen-api`;
  const KEY_STORE = "lilys-kitchen-key";
  const QUEUE_STORE = "lilys-kitchen-pending";
  const TOUR_STORE = "lilys-kitchen-tour-v1";
  const POLL_MS = 5000;
  const OFFLINE_BANNER_AFTER_MS = 45000;
  const RECALL_WINDOW_MS = 60 * 60 * 1000;
  const REMIND_EVERY_MS = 30000;
  const CLOSED_POLL_MS = 60000; // slow down overnight — saves battery + function quota
  // age thresholds per state, minutes → [warn, late]
  const AGE = { paid: [3, 6], making: [12, 18], ready: [10, 20] };
  // Florida-time opening hours — keep in sync with data.js HOURS (0=Sun..6=Sat)
  const HOURS = { 0: [11, 22], 1: [11, 22], 2: [11, 22], 3: null, 4: [11, 22], 5: [11, 23], 6: [11, 23] };
  const flNow = () => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day, hour: (parseInt(get("hour"), 10) % 24) + parseInt(get("minute"), 10) / 60 };
  };
  const kitchenOpen = () => {
    const { day, hour } = flNow();
    const t = HOURS[day];
    return !!t && hour >= t[0] - 0.5 && hour < t[1] + 0.5; // half-hour grace both sides
  };

  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const telHref = (s) => "tel:" + String(s ?? "").replace(/[^+\d]/g, "");
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const clock = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // one-tap setup: kitchen.html#key=<kitchen key> logs this tablet in with no
  // typing. The home-screen icon is added FROM that link, so it reopens with the
  // key on every launch and never asks again, even if iOS clears its storage.
  // A #fragment is never sent to any server.
  const hashKey = new URLSearchParams(location.hash.slice(1)).get("key") || "";
  if (hashKey) { try { localStorage.setItem(KEY_STORE, hashKey); } catch { /* fine */ } }
  let key = hashKey || localStorage.getItem(KEY_STORE) || "";
  let orders = [];
  let knownIds = new Set(); // orders seen at least once (arrival chime + flash)
  let firstLoad = true;
  let recalled = new Set(); // ids recalled this session — red RECALLED chip
  let lastOkAt = 0;
  let failCount = 0;
  let offlineShown = false;
  let pollTimer = 0;
  let undoState = null; // {id, from, label, timer}
  let pending = []; // queued taps while offline: {id, to, at}
  try { pending = JSON.parse(localStorage.getItem(QUEUE_STORE) || "[]"); } catch { pending = []; }
  const savePending = () => localStorage.setItem(QUEUE_STORE, JSON.stringify(pending));
  const inFlight = new Map(); // id → target status, so a stale poll can't undo an optimistic tap

  /* ------------------------------------------------------------ sound ---- */
  let audioCtx = null;
  let remindTimer = 0;
  const soundReady = () => audioCtx?.state === "running";
  const ensureAudio = () => {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.onstatechange = () => updateShell(); // sound banner follows ctx state
      } catch { /* no audio available */ }
    }
    if (audioCtx?.state === "suspended") audioCtx.resume();
  };
  const chime = (gain = 0.4) => {
    if (!soundReady()) return;
    const t0 = audioCtx.currentTime;
    [[880, 0], [1174.66, 0.18]].forEach(([f, dt]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(gain, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.7);
    });
  };
  // soft reminder while anything sits un-started (louder once a ticket is
  // overdue-red) — no modal ack anywhere
  const syncReminder = () => {
    const anyNew = orders.some((o) => o.status === "paid");
    if (anyNew && !remindTimer) {
      remindTimer = setInterval(() => {
        const anyLate = orders.some((o) => o.status === "paid" && ageClass(o) === "age-late");
        chime(anyLate ? 0.45 : 0.22);
      }, REMIND_EVERY_MS);
    }
    if (!anyNew && remindTimer) { clearInterval(remindTimer); remindTimer = 0; }
  };

  /* ---------------------------------------------------------- battery ---- */
  let battery = null; // a dead tablet is a deaf kitchen — warn before it happens
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      battery = b;
      ["levelchange", "chargingchange"].forEach((ev) => b.addEventListener(ev, () => updateShell()));
      updateShell();
    }).catch(() => {});
  }
  const batteryLow = () => battery && !battery.charging && battery.level <= 0.2;

  /* -------------------------------------------------------- wake lock ---- */
  let wakeLock = null;
  const acquireWakeLock = async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      if (!wakeLock || wakeLock.released) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => updateShell());
        updateShell();
      }
    } catch { /* battery saver / not allowed — ☾ indicator shows it */ }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      acquireWakeLock();
      if (audioCtx?.state === "suspended") audioCtx.resume();
      refresh();
    }
  });

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
    // only OUR "wrong key" answer logs the tablet out. A 401 from Supabase's own
    // gateway is an outage, not a bad key, and must never wipe a working login.
    if (r.status === 401 && j.error === "Wrong kitchen key") throw Object.assign(new Error("Wrong kitchen key"), { auth: true });
    if (r.status === 409) throw Object.assign(new Error(j.error || "conflict"), { conflict: true });
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };

  const replayPending = async () => {
    while (pending.length) {
      const a = pending[0];
      if (Date.now() - a.at > 2 * 3600 * 1000) { pending.shift(); savePending(); continue; }
      try {
        await call({ action: "advance", id: a.id, to: a.to });
        pending.shift();
        savePending();
      } catch (e) {
        if (e.auth) throw e;
        if (e.conflict) { pending.shift(); savePending(); continue; } // state moved on — drop
        break; // still offline — keep the queue
      }
    }
  };

  const logout = (msg) => {
    localStorage.removeItem(KEY_STORE);
    key = "";
    stopEverything();
    renderLogin(msg);
  };

  const refresh = async () => {
    if (!key) return;
    try {
      await replayPending();
      const { orders: list } = await call({ action: "list" });
      // a list snapshot can be older than a tap we just made — local wins
      list.forEach((o) => {
        const override = inFlight.get(o.id) ?? pending.find((p) => p.id === o.id)?.to;
        if (override) o.status = override;
      });
      const incoming = new Set(list.map((o) => o.id));
      const newPaid = list.filter((o) => o.status === "paid" && !knownIds.has(o.id));
      if (!firstLoad && newPaid.length) chime();
      list.forEach((o) => { o._fresh = !firstLoad && o.status === "paid" && !knownIds.has(o.id); });
      list.forEach((o) => knownIds.add(o.id));
      [...knownIds].forEach((id) => { if (!incoming.has(id)) knownIds.delete(id); });
      orders = practice ? [...list, practice] : list;
      firstLoad = false;
      lastOkAt = Date.now();
      failCount = 0;
      syncReminder();
      renderBoard();
      maybeAutoTour();
    } catch (e) {
      if (e.auth) { logout(e.message); return; }
      failCount++;
      updateShell(); // flip the dot / offline banner, keep the board intact
    }
    schedulePoll();
  };

  const schedulePoll = () => {
    clearTimeout(pollTimer);
    const active = orders.some((o) => ["paid", "making", "ready"].includes(o.status));
    const delay = failCount > 0
      ? Math.min(5000 * 2 ** (failCount - 1), 30000)
      : !kitchenOpen() && !active
      ? CLOSED_POLL_MS
      : POLL_MS;
    pollTimer = setTimeout(refresh, delay);
  };

  const stopEverything = () => {
    clearTimeout(pollTimer);
    clearInterval(remindTimer);
    remindTimer = 0;
  };

  /* -------------------------------------------- actions (optimistic) ---- */
  const act = async (id, to, { undoable = true, label = "" } = {}) => {
    // the tutorial's practice order lives only on this tablet: never sent anywhere
    if (String(id).startsWith("practice-")) {
      const p = orders.find((x) => x.id === id);
      const was = p?.status;
      if (p) { p.status = to; p.updated_at = new Date().toISOString(); p._fresh = false; }
      renderBoard();
      if (undoable && was) showUndo({ id, from: was, label });
      tourOnAct(to);
      return;
    }
    const o = orders.find((x) => x.id === id);
    const from = o?.status;
    if (o) { o.status = to; o.updated_at = new Date().toISOString(); o._fresh = false; }
    inFlight.set(id, to);
    syncReminder();
    renderBoard();
    if (undoable && from) showUndo({ id, from, label });
    try {
      await call({ action: "advance", id, to });
      inFlight.delete(id);
    } catch (e) {
      inFlight.delete(id);
      if (e.auth) { logout(e.message); return; }
      if (e.conflict) { refresh(); return; } // someone else moved it — resync
      pending.push({ id, to, at: Date.now() }); // offline — queue for replay
      savePending();
    }
  };

  /* ------------------------------------------------------------- undo ---- */
  const showUndo = ({ id, from, label }) => {
    clearTimeout(undoState?.timer);
    undoState = { id, from, label, timer: setTimeout(() => { undoState = null; updateShell(); }, 5000) };
    updateShell();
  };
  const doUndo = () => {
    if (!undoState) return;
    const { id, from } = undoState;
    clearTimeout(undoState.timer);
    undoState = null;
    updateShell();
    act(id, from, { undoable: false });
  };

  /* ------------------------------------------------------------ views ---- */
  function renderLogin(err = "") {
    stopEverything();
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
      acquireWakeLock();
      firstLoad = true;
      lastSnapshot = "";
      app.innerHTML = `<div class="k-login"><p>Connecting…</p></div>`;
      refresh();
    };
    document.getElementById("keyGo").addEventListener("click", go);
    document.getElementById("keyIn").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  const mins = (iso) => Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  const fmtTimer = (iso) => {
    const total = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  const ageBase = (o) => (o.status === "ready" ? o.updated_at : o.created_at);
  const ageClass = (o) => {
    const [warn, late] = AGE[o.status] || [999, 999];
    const m = mins(ageBase(o));
    return m >= late ? "age-late" : m >= warn ? "age-warn" : "";
  };

  function ticket(o) {
    const items = (o.items || [])
      .map((l) => `<div class="t-item"><b>${l.qty}×</b><span>${esc(l.name)}${l.addons?.length
        ? `<span class="t-adds">+ ${l.addons.map((a) => esc(a.name)).join(", ")}</span>` : ""}</span></div>`)
      .join("");
    const meta = `<div class="t-meta"><span>${esc(o.customer_name)}</span> · <a href="${telHref(o.customer_phone)}">${esc(o.customer_phone)}</a>${o.demo ? '<span class="t-demo">test</span>' : ""}</div>`;
    const band = `
      <div class="t-band ${ageClass(o)}" data-band="${o.id}">
        <span class="t-code">${esc(o.code)}</span>
        <span class="t-right">
          ${recalled.has(o.id) ? '<span class="t-chip recalled">Recalled</span>' : ""}
          <span class="t-chip">${o.status === "paid" ? "New" : "Making"}</span>
          <span class="t-timer" data-ts="${esc(ageBase(o))}" data-oid="${o.id}">${fmtTimer(ageBase(o))}</span>
        </span>
      </div>`;
    const notes = o.notes ? `<div class="t-notes">${esc(o.notes)}</div>` : "";
    const del = deliveryBlock(o);
    // a pickup tip is for the team; delivery tips show in the delivery block
    const tipNote = o.fulfilment !== "delivery" && o.tip_cents > 0
      ? `<div class="t-del-tip">Tip ${money(o.tip_cents)} for the team (paid online)</div>` : "";
    if (o.status === "paid") {
      return `<div class="t new ${o._fresh ? "fresh" : ""}" data-start="${o.id}">
        ${band}<div class="t-body">${items}${notes}${del}${tipNote}</div>${meta}
        <div class="t-hint">Tap to start</div>
      </div>`;
    }
    return `<div class="t">
      ${band}<div class="t-body">${items}${notes}${del}${tipNote}</div>${meta}
      <div class="t-actions">
        <button class="t-go" data-ready="${o.id}">Ready</button>
        <button class="t-more" data-more="${o.id}" aria-label="More options for ${esc(o.code)}">···</button>
      </div>
    </div>`;
  }

  // delivery orders: the driver needs the address and distance at a glance, and
  // the tip is shown so it can be handed over (it was paid online with the order)
  function deliveryBlock(o) {
    if (o.fulfilment !== "delivery") return "";
    const miles = o.delivery_miles != null ? ` · ${Number(o.delivery_miles).toFixed(1)} mi` : "";
    const tip = o.tip_cents > 0 ? `<div class="t-del-tip">Driver tip ${money(o.tip_cents)} (paid online)</div>` : "";
    // the label lives here, not in the band: the band is already full on a
    // portrait tablet and an extra chip pushed the timer off the card
    return `<div class="t-del"><div class="t-del-l">Delivery</div><div class="t-del-addr">${esc(o.delivery_address || "")}${miles}</div>${tip}</div>`;
  }

  function railCard(o) {
    return `<div class="t ready-card">
      <div class="t-band ${ageClass(o)}" data-band="${o.id}">
        <span class="t-code">${esc(o.code)}</span>
        <span class="t-right"><span class="t-timer" data-ts="${esc(o.updated_at)}" data-oid="${o.id}">${fmtTimer(o.updated_at)}</span></span>
      </div>
      <div class="t-name">${esc(o.customer_name)}</div>
      ${deliveryBlock(o)}
      <div class="t-sub">${(o.items || []).reduce((s, l) => s + l.qty, 0)} items · <a href="${telHref(o.customer_phone)}" style="color:inherit">${esc(o.customer_phone)}</a>${o.demo ? ' · <span class="t-demo">test</span>' : ""}</div>
      <div class="t-actions">
        <button class="t-go" data-picked="${o.id}">${o.fulfilment === "delivery" ? "Out for delivery" : "Picked up"}</button>
        <button class="t-more" data-more="${o.id}" aria-label="More options for ${esc(o.code)}">···</button>
      </div>
    </div>`;
  }

  const offlineNow = () => failCount > 0 && lastOkAt && Date.now() - lastOkAt > OFFLINE_BANNER_AFTER_MS;

  // today's numbers, straight off the board data (canceled excluded)
  const todayStats = () => {
    const today = new Date().toDateString();
    const t = orders.filter((o) => o.status !== "canceled" && new Date(o.created_at).toDateString() === today);
    const cents = t.reduce((s, o) => s + (o.demo ? 0 : o.total_cents), 0);
    const demos = t.filter((o) => o.demo).length;
    return { count: t.length, cents, demos };
  };

  function shellHTML() {
    const s = todayStats();
    const statsLine = s.count
      ? `today ${s.count} order${s.count === 1 ? "" : "s"}${s.cents ? ` · ${money(s.cents)}` : ""}${s.demos ? ` · ${s.demos} test` : ""}`
      : "";
    return `
      <div class="k-head">
        <div class="k-brand">Lily<em>'s</em> Kitchen</div>
        <div class="k-head-meta">
          ${statsLine ? `<span class="k-stamp">${statsLine}</span>` : ""}
          <span class="k-stamp" id="kStamp">updated ${lastOkAt ? clock(new Date(lastOkAt)) : "—"}</span>
          <span><i class="k-dot${failCount > 0 ? " err" : ""}"></i></span>
          ${wakeLock && !wakeLock.released ? "" : '<span title="Screen may sleep">☾</span>'}
          <button class="k-tool" id="kSound" title="Test sound">${soundReady() ? "♪" : "🔕"}</button>
          <button class="k-tool" id="kStock" title="Mark items out of stock">86</button>
          <button class="k-tool" id="kPromo" title="Switch offers on and off">%</button>
          <button class="k-tool" id="kHelp" title="How to use this screen">?</button>
          <button class="k-tool" id="kFull" title="Fullscreen" ${document.fullscreenElement ? "hidden" : ""}>⛶</button>
          <span class="k-clock" id="kClock">${clock(new Date())}</span>
        </div>
      </div>
      ${soundReady() ? "" : '<div class="k-banner sound" id="kSoundBanner">🔕 Tap anywhere to enable the new-order sound</div>'}
      ${batteryLow() ? `<div class="k-banner offline">🔋 Tablet battery at ${Math.round(battery.level * 100)}% and not charging — plug it in or the board goes dark</div>` : ""}
      ${offlineNow() ? `<div class="k-banner offline">OFFLINE — showing orders as of ${clock(new Date(lastOkAt))}. Taps are saved and will sync.</div>` : ""}
      ${!kitchenOpen() && !orders.some((o) => ["paid", "making", "ready"].includes(o.status)) ? '<div class="k-banner closed">Kitchen closed — board is resting, checking once a minute. New orders still ring through.</div>' : ""}`;
  }

  function undoHTML() {
    if (!undoState) return "";
    return `<div class="k-undo">
      <span>${esc(undoState.label)}</span>
      <button id="kUndoBtn">Undo</button>
      <span class="bar"></span>
    </div>`;
  }

  function updateShell() {
    const shell = document.getElementById("kShell");
    const undoWrap = document.getElementById("kUndoWrap");
    if (!shell || !undoWrap) return;
    shell.innerHTML = shellHTML();
    undoWrap.innerHTML = undoHTML();
    offlineShown = offlineNow();
    wireShell();
  }

  function wireShell() {
    document.getElementById("kSound")?.addEventListener("click", () => { ensureAudio(); setTimeout(() => chime(), 80); });
    document.getElementById("kSoundBanner")?.addEventListener("click", () => ensureAudio());
    document.getElementById("kStock")?.addEventListener("click", openStock);
    document.getElementById("kPromo")?.addEventListener("click", openOffers);
    document.getElementById("kHelp")?.addEventListener("click", () => startTour());
    document.getElementById("kFull")?.addEventListener("click", () => document.documentElement.requestFullscreen?.().catch(() => {}));
    document.getElementById("kUndoBtn")?.addEventListener("click", doUndo);
  }

  let lastSnapshot = "";
  /* ---- 86 / stock -------------------------------------------------------
     An overlay rather than a view swap: the order board must never disappear
     while someone is mid-service. Same four states as Kareem's Sauce editor,
     for dishes AND add-ons: Available, Out today (back by itself at 4am),
     Out (until switched back), Hidden (off the menu). The server stores and
     enforces them; this sheet is only the switch. */
  let stockItems = null;   // [{id, name, category, state}]
  let stockAddons = null;  // [{id, label, options: [{id, name, state}]}]
  let stockQuery = "";
  const STATES = [["on", "Available"], ["today", "Out today"], ["off", "Out"], ["hidden", "Hidden"]];

  async function openStock() {
    let wrap = document.getElementById("kStockWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "kStockWrap";
      document.body.appendChild(wrap);
    }
    stockQuery = "";
    wrap.innerHTML = `<div class="k-sheet"><div class="k-sheet-head">
        <h2>Stock</h2><button class="k-sheet-x" id="kStockX">Done</button>
      </div>
      <div class="k-stock-tools"><input id="kStockQ" type="search" placeholder="Find a dish or add-on" autocomplete="off"></div>
      <div class="k-sheet-body"><p class="k-none">Loading the menu…</p></div></div>`;
    document.getElementById("kStockX").addEventListener("click", closeStock);
    document.getElementById("kStockQ").addEventListener("input", (e) => { stockQuery = e.target.value.trim().toLowerCase(); paintStock(); });
    try {
      const r = await call({ action: "stock" });
      stockItems = r.items || [];
      stockAddons = r.addons || [];
      paintStock();
    } catch (e) {
      if (e.auth) { closeStock(); logout(e.message); return; }
      wrap.querySelector(".k-sheet-body").innerHTML =
        `<p class="k-none">Couldn't load the menu. Check the connection and try again.</p>`;
    }
  }

  function closeStock() {
    document.getElementById("kStockWrap")?.remove();
    stockItems = stockAddons = null;
  }

  function stockRow(kind, i) {
    return `<div class="k-stock-row s-${i.state}">
      <span class="n">${esc(i.name)}</span>
      <span class="k-seg" role="group" aria-label="${esc(i.name)}">
        ${STATES.map(([st, label]) => `<button data-kind="${kind}" data-id="${esc(i.id)}" data-state="${st}"
          class="${i.state === st ? "on" : ""}" aria-pressed="${i.state === st}">${label}</button>`).join("")}
      </span>
    </div>`;
  }

  function paintStock() {
    const body = document.querySelector("#kStockWrap .k-sheet-body");
    if (!body || !stockItems) return;
    const q = stockQuery;
    const hit = (name, group) => !q || name.toLowerCase().includes(q) || group.toLowerCase().includes(q);
    const allAddons = stockAddons.flatMap((g) => g.options);
    const off = [...stockItems, ...allAddons].filter((i) => i.state !== "on");
    const today = off.filter((i) => i.state === "today").length;
    const cats = [...new Set(stockItems.map((i) => i.category))];
    const dishHTML = cats.map((c) => {
      const rows = stockItems.filter((i) => i.category === c && hit(i.name, c));
      return rows.length ? `<div class="k-stock-cat">${esc(c)}</div>${rows.map((i) => stockRow("item", i)).join("")}` : "";
    }).join("");
    const addonHTML = stockAddons.map((g) => {
      const rows = g.options.filter((o) => hit(o.name, g.label));
      return rows.length ? `<div class="k-stock-cat">Add-ons · ${esc(g.label)}</div>${rows.map((o) => stockRow("addon", o)).join("")}` : "";
    }).join("");
    body.innerHTML = `
      <p class="k-sheet-note">${off.length
        ? `${off.length} switched off${today ? `, ${today} back automatically tomorrow morning` : ""}.`
        : "Everything is available."}
        Changes reach the website straight away. <b>Out today</b> comes back by itself at 4am.</p>
      ${dishHTML + addonHTML || `<p class="k-none">Nothing matches “${esc(stockQuery)}”.</p>`}`;
  }

  // one listener for the whole sheet, so repainting never loses a handler
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#kStockWrap [data-state]");
    if (b) setStock(b.dataset.kind, b.dataset.id, b.dataset.state);
  });

  async function setStock(kind, id, want) {
    const list = kind === "addon" ? stockAddons?.flatMap((g) => g.options) : stockItems;
    const it = list?.find((i) => i.id === id);
    if (!it || it.state === want) return;
    const was = it.state;
    it.state = want;          // optimistic — a tap must feel instant on a tablet
    paintStock();
    try {
      const r = await call({ action: "set_stock", kind, id, state: want });
      if (r.state && r.state !== want) { it.state = r.state; paintStock(); }
    } catch (e) {
      it.state = was;         // put it back; never leave a switch lying
      paintStock();
      if (e.auth) { closeStock(); logout(e.message); }
    }
  }

  /* ---- offers -----------------------------------------------------------
     Same overlay as the 86 sheet, same reason. Kareem switches a pre-authored
     offer on or off; he cannot author one here. The discount arithmetic only
     ever runs server-side in create-checkout, so nothing on this screen can
     change what a customer is charged beyond whether an offer applies at all. */
  let promos = null;
  let promosNow = 0;

  function promoDesc(p) {
    let what;
    if (p.kind === "bogo") {
      what = p.buy_qty === 1 && p.free_qty === 1
        ? "Buy one, get one free"
        : `Buy ${p.buy_qty}, get ${p.free_qty} free`;
    } else if (p.kind === "percent_items") {
      const parts = [...(p.categories || []), ...((p.item_ids || []).length ? [`${p.item_ids.length} dish${p.item_ids.length > 1 ? "es" : ""}`] : [])];
      what = `${p.percent}% off ${parts.join(", ")}`;
    } else {
      what = `${p.percent}% off orders over ${money(p.min_subtotal_cents)}`;
    }
    const when = promoSchedule(p);
    return when ? `${what} · ${when}` : what;
  }

  // "Mon, Tue, Fri · 11am to 3pm"; empty when it runs every day, all day
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hm = (m) => { const h = Math.floor(m / 60), mi = m % 60; return `${h % 12 || 12}${mi ? ":" + String(mi).padStart(2, "0") : ""}${h < 12 || h === 24 ? "am" : "pm"}`; };
  function promoSchedule(p) {
    const days = (p.days || []).length && p.days.length < 7 ? p.days.map((d) => DAY[d]).join(", ") : "";
    const time = p.start_min != null && p.end_min != null ? `${hm(p.start_min)} to ${hm(p.end_min)}` : "";
    return [days, time].filter(Boolean).join(" · ");
  }
  // = create-checkout promoRunsAt, on the Florida clock
  function promoRunsNow(p) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(promosNow));
    const get = (t) => parts.find((x) => x.type === t)?.value ?? "";
    const day = DAY.indexOf(get("weekday"));
    const minute = (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10);
    if ((p.days || []).length && !p.days.includes(day)) return false;
    if (p.start_min == null || p.end_min == null) return true;
    return minute >= p.start_min && minute < p.end_min;
  }

  // An offer switched on outside its own dates is the one genuinely confusing
  // state here: the row reads as running when it isn't. Say so on the row
  // rather than letting someone wonder why nobody is getting the discount.
  function promoWindow(p) {
    const from = p.starts_at ? Date.parse(p.starts_at) : NaN;
    const to = p.ends_at ? Date.parse(p.ends_at) : NaN;
    if (!Number.isNaN(to) && to <= promosNow) return "finished";
    if (!Number.isNaN(from) && from > promosNow) return "not started yet";
    if (!promoRunsNow(p)) return "outside its days or hours right now";
    return null;
  }

  async function openOffers() {
    let wrap = document.getElementById("kPromoWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "kPromoWrap";
      document.body.appendChild(wrap);
    }
    wrap.innerHTML = `<div class="k-sheet"><div class="k-sheet-head">
        <h2>Offers</h2><button class="k-sheet-x" id="kPromoX">Done</button>
      </div><div class="k-sheet-body"><p class="k-none">Loading offers…</p></div></div>`;
    document.getElementById("kPromoX").addEventListener("click", closeOffers);
    try {
      const r = await call({ action: "promos" });
      promos = r.promos || [];
      promosNow = Date.parse(r.now) || Date.now();
      paintOffers();
    } catch (e) {
      if (e.auth) { closeOffers(); logout(e.message); return; }
      wrap.querySelector(".k-sheet-body").innerHTML =
        `<p class="k-none">Couldn't load the offers. Check the connection and try again.</p>`;
    }
  }

  function closeOffers() {
    document.getElementById("kPromoWrap")?.remove();
    promos = null;
  }

  function paintOffers() {
    const body = document.querySelector("#kPromoWrap .k-sheet-body");
    if (!body) return;
    if (!promos.length) {
      body.innerHTML = `<p class="k-sheet-note">No offers set up yet. Ask Zachary to add one
        and it will appear here ready to switch on.</p>`;
      return;
    }
    const on = promos.filter((p) => p.active).length;
    body.innerHTML = `
      <p class="k-sheet-note">${on ? `${on} offer${on > 1 ? "s" : ""} running.` : "No offers running."}
        Switching one on applies it to new website orders straight away. It never
        changes an order that has already been paid for.</p>
      ${promos.map((p) => {
        const w = p.active ? promoWindow(p) : null;
        return `
        <button class="k-promo-row${p.active ? " on" : ""}" data-promo="${esc(p.id)}">
          <span>
            <span class="t">${esc(p.label)}</span>
            <span class="d">${esc(promoDesc(p))}${w ? ` <span class="warn">— on, but ${esc(w)}</span>` : ""}</span>
          </span>
          <span class="s">${p.active ? "On" : "Off"}</span>
        </button>`;
      }).join("")}`;
    body.querySelectorAll("[data-promo]").forEach((btn) =>
      btn.addEventListener("click", () => togglePromo(btn.dataset.promo)));
  }

  async function togglePromo(id) {
    const p = promos?.find((x) => x.id === id);
    if (!p) return;
    const want = !p.active;
    p.active = want;          // optimistic, like the 86 sheet — a tap must feel instant
    paintOffers();
    try {
      const r = await call({ action: "set_promo", id, active: want });
      if (typeof r.active === "boolean" && r.active !== want) { p.active = r.active; paintOffers(); }
    } catch (e) {
      p.active = !want;       // put it back; never leave a toggle lying about the money path
      paintOffers();
      if (e.auth) { closeOffers(); logout(e.message); }
    }
  }

  function renderBoard() {
    if (!key) return renderLogin();
    if (!document.getElementById("kBoard")) {
      app.innerHTML = `<div id="kShell"></div><div id="kBoard"></div><div id="kUndoWrap"></div>`;
      lastSnapshot = "";
    }
    updateShell();

    const snapshot = JSON.stringify([orders, [...recalled]]);
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;

    const queue = orders.filter((o) => ["paid", "making"].includes(o.status)); // oldest first
    const ready = orders.filter((o) => o.status === "ready");
    const past = orders.filter((o) => ["done", "canceled"].includes(o.status)).reverse();
    const doneWasOpen = document.querySelector(".k-done details")?.open ?? false;

    document.getElementById("kBoard").innerHTML = `
      <div class="k-main">
        <div class="k-queue">
          <div class="k-zone-label">Kitchen queue${queue.length ? ` · ${queue.length}` : ""}</div>
          ${queue.length ? queue.map(ticket).join("") : '<div class="k-none">No open orders — the board will chime when one lands.</div>'}
          <div class="k-done">
            <details${doneWasOpen ? " open" : ""}>
              <summary>Earlier today (${past.length})</summary>
              ${past.map((o) => {
                const recallable = o.status === "done" && Date.now() - new Date(o.updated_at).getTime() < RECALL_WINDOW_MS;
                return `<div class="k-done-line">
                  <span class="c">${esc(o.code)}</span>
                  <span class="s ${o.status}">${o.status === "done" ? "picked up" : o.status}</span>
                  <span class="n">${esc(o.customer_name)} · ${money(o.total_cents)}</span>
                  ${recallable ? `<button class="recall" data-recall="${o.id}">Recall</button>` : ""}
                </div>`;
              }).join("")}
            </details>
          </div>
        </div>
        <div class="k-rail">
          <div class="k-zone-label">Ready for pickup${ready.length ? ` · ${ready.length}` : ""}</div>
          ${ready.length ? ready.map(railCard).join("") : '<div class="k-none">Nothing waiting.</div>'}
        </div>
      </div>`;
    wireBoard();
  }

  /* ---- tutorial ----------------------------------------------------------
     An interactive walkthrough built around a practice order that exists only
     in this tablet's memory. Kareem taps it through the real buttons (start,
     ready, picked up) and the coach waits for each tap before moving on.
     Runs once automatically, and any time from the ? button. Highlights are
     driven by a body attribute so they survive the board re-rendering. */
  let practice = null;
  let tour = null; // { i }
  const TOUR = [
    { id: "welcome", title: "Welcome to Lily's Kitchen",
      text: "This screen shows every online order the moment it's paid. This 2-minute walkthrough uses a practice order, so nothing you tap here reaches a customer." },
    { id: "sound", title: "First, sound",
      text: "Tap the ♪ button at the top to hear the new-order chime. If you ever see a yellow \"Tap anywhere\" bar, tap the screen once so the sound can play." },
    { id: "arrive", title: "A new order just came in",
      text: "New orders appear on the left in yellow, with a chime. The timer shows how long ago it arrived. This one says PRACTICE, so it's pretend.",
      enter: () => { addPractice(); try { chime(); } catch { /* sound not ready yet */ } } },
    { id: "start", title: "Start making it", wait: "making",
      text: "Tap the yellow practice order. That tells the screen you've started cooking it." },
    { id: "ready", title: "Food's ready?", wait: "ready",
      text: "Tap the orange READY button when the food is bagged and ready to go." },
    { id: "picked", title: "Customer collects it", wait: "done",
      text: "Ready orders move to the right, so they're easy to find at the counter. When the customer takes it, tap PICKED UP." },
    { id: "undo", title: "Tapped the wrong thing?",
      text: "Right after any tap, an UNDO button shows at the bottom for a few seconds. Picked-up orders also wait under \"Earlier today\" with a Recall button." },
    { id: "more", title: "The ··· button",
      text: "Every order has a ··· button: go back a step, call the customer, or cancel. Cancelling does NOT refund the customer. Refunds are done in Stripe." },
    { id: "stock", title: "Run out of something?",
      text: "Tap 86 at the top, then tap the dish. It disappears from the website straight away. Tap it again when it's back." },
    { id: "daily", title: "Every day",
      text: "Keep the iPad plugged in and open on this screen while you're open. After opening, tap the screen once so the sound works. Tap ? at the top any time to see this again." },
  ];

  function addPractice() {
    if (practice) return;
    const now = new Date().toISOString();
    practice = {
      id: "practice-1", code: "PRACTICE", status: "paid", demo: true,
      customer_name: "Practice order", customer_phone: "",
      notes: "Pretend order for the walkthrough. Nobody will collect it.",
      items: [{ qty: 2, name: "Chicken Shawarma Wrap" }, { qty: 1, name: "Batata Harrah" }],
      subtotal_cents: 0, tax_cents: 0, total_cents: 0, created_at: now, updated_at: now,
      fulfilment: "pickup", _fresh: true,
    };
    orders = [...orders.filter((o) => o.id !== practice.id), practice];
    renderBoard();
  }

  function removePractice() {
    practice = null;
    orders = orders.filter((o) => !String(o.id).startsWith("practice-"));
    renderBoard();
  }

  function startTour() {
    ensureAudio();
    tour = { i: 0 };
    removePractice();
    showStep();
  }

  function endTour() {
    try { localStorage.setItem(TOUR_STORE, "done"); } catch { /* fine */ }
    tour = null;
    document.body.removeAttribute("data-tour");
    document.getElementById("kTour")?.remove();
    removePractice();
  }

  function maybeAutoTour() {
    let done = "";
    try { done = localStorage.getItem(TOUR_STORE) || ""; } catch { /* fine */ }
    if (!done && !tour) startTour();
  }

  function goStep(i) {
    if (!tour) return;
    tour.i = Math.max(0, Math.min(TOUR.length - 1, i));
    showStep();
  }

  // a practice tap moves the coach on only when it's the tap we asked for
  function tourOnAct(to) {
    if (!tour) return;
    const step = TOUR[tour.i];
    if (step.wait && step.wait === to) goStep(tour.i + 1);
  }

  function showStep() {
    const step = TOUR[tour.i];
    step.enter?.();
    document.body.setAttribute("data-tour", step.id);
    let el = document.getElementById("kTour");
    if (!el) {
      el = document.createElement("div");
      el.id = "kTour";
      document.body.appendChild(el);
    }
    const last = tour.i === TOUR.length - 1;
    el.innerHTML = `
      <div class="kt-step">Step ${tour.i + 1} of ${TOUR.length}</div>
      <h2>${esc(step.title)}</h2>
      <p>${esc(step.text)}</p>
      ${step.wait ? '<div class="kt-wait">Waiting for your tap…</div>' : ""}
      <div class="kt-btns">
        <button class="kt-skip" id="ktSkip">${last ? "" : "Skip tutorial"}</button>
        <span>
          ${tour.i > 0 ? '<button class="kt-back" id="ktBack">Back</button>' : ""}
          ${step.wait ? "" : `<button class="kt-next" id="ktNext">${tour.i === 0 ? "Start" : last ? "Finish" : "Next"}</button>`}
        </span>
      </div>`;
    el.querySelector("#ktSkip").hidden = last;
    el.querySelector("#ktSkip").addEventListener("click", endTour);
    el.querySelector("#ktBack")?.addEventListener("click", () => {
      // going back past the practice order's arrival resets it
      if (TOUR[tour.i - 1] && ["welcome", "sound"].includes(TOUR[tour.i - 1].id)) removePractice();
      else if (practice && TOUR[tour.i - 1]?.wait) { practice.status = { making: "paid", ready: "making", done: "ready" }[TOUR[tour.i - 1].wait]; renderBoard(); }
      goStep(tour.i - 1);
    });
    el.querySelector("#ktNext")?.addEventListener("click", () => (last ? endTour() : goStep(tour.i + 1)));
  }

  function wireBoard() {
    const board = document.getElementById("kBoard");
    board.querySelectorAll("[data-start]").forEach((card) =>
      card.addEventListener("click", (e) => {
        if (e.target.closest("a")) return; // phone link
        const o = orders.find((x) => x.id === card.dataset.start);
        act(card.dataset.start, "making", { label: `${o?.code ?? ""} started` });
      })
    );
    board.querySelectorAll("[data-ready]").forEach((b) =>
      b.addEventListener("click", () => {
        const o = orders.find((x) => x.id === b.dataset.ready);
        act(b.dataset.ready, "ready", { label: `${o?.code ?? ""} → Ready` });
      })
    );
    board.querySelectorAll("[data-picked]").forEach((b) =>
      b.addEventListener("click", () => {
        const o = orders.find((x) => x.id === b.dataset.picked);
        act(b.dataset.picked, "done", { label: `${o?.code ?? ""} picked up` });
      })
    );
    board.querySelectorAll("[data-recall]").forEach((b) =>
      b.addEventListener("click", () => {
        recalled.add(b.dataset.recall);
        const o = orders.find((x) => x.id === b.dataset.recall);
        act(b.dataset.recall, "making", { label: `${o?.code ?? ""} recalled` });
      })
    );
    board.querySelectorAll("[data-more]").forEach((b) =>
      b.addEventListener("click", () => openSheet(b.dataset.more))
    );
  }

  function openSheet(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    const wrap = document.createElement("div");
    wrap.className = "k-sheet-wrap";
    const refundLink = !o.demo && o.stripe_payment_intent
      ? `<a class="plain" style="display:grid;place-items:center;min-height:52px;text-decoration:none;border-radius:8px;font-family:var(--mono);letter-spacing:0.08em;text-transform:uppercase;font-size:15px" href="https://dashboard.stripe.com/payments/${esc(o.stripe_payment_intent)}" target="_blank" rel="noopener">Open in Stripe (refund)</a>`
      : "";
    wrap.innerHTML = `
      <div class="k-sheet">
        <h3>${esc(o.code)} · ${esc(o.customer_name)}</h3>
        ${o.demo ? "" : '<p class="warn">Canceling does NOT refund the payment — issue the refund in the Stripe dashboard.</p>'}
        ${refundLink}
        <button class="danger" id="sheetCancel">Cancel this order</button>
        <button class="plain" id="sheetClose">Never mind</button>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector("#sheetClose").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#sheetCancel").addEventListener("click", () => {
      wrap.remove();
      act(id, "canceled", { undoable: false });
    });
  }

  /* -------------------------------------------------- 1s ticker -------- */
  // updates timers, age bands, and the clock in place — never rebuilds DOM
  setInterval(() => {
    if (!key) return;
    document.querySelectorAll(".t-timer[data-ts]").forEach((el) => {
      el.textContent = fmtTimer(el.dataset.ts);
      const o = orders.find((x) => x.id === el.dataset.oid);
      if (o) {
        const band = document.querySelector(`[data-band="${o.id}"]`);
        if (band) {
          const cls = ageClass(o);
          band.classList.toggle("age-warn", cls === "age-warn");
          band.classList.toggle("age-late", cls === "age-late");
        }
      }
    });
    const c = document.getElementById("kClock");
    if (c) c.textContent = clock(new Date());
    // offline banner threshold can be crossed between polls
    if (offlineNow() !== offlineShown) updateShell();
    // belt-and-braces wake lock check (locks drop silently on battery saver)
    if (wakeLock?.released && document.visibilityState === "visible") acquireWakeLock();
  }, 1000);

  document.addEventListener("pointerdown", () => {
    const was = soundReady();
    ensureAudio();
    setTimeout(() => { if (soundReady() !== was) updateShell(); }, 150);
  });
  document.addEventListener("fullscreenchange", () => updateShell());

  if (key) {
    app.innerHTML = `<div class="k-login"><p>Connecting…</p></div>`;
    acquireWakeLock();
    refresh();
  } else {
    renderLogin();
  }
})();
