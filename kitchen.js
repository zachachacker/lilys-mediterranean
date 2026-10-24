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
  const PRINT_STORE = "lilys-kitchen-print-on-start";
  const EPSON_STORE = "lilys-kitchen-epson"; // printer address on this device, e.g. 192.168.1.16
  const AUTOPRINT_STORE = "lilys-kitchen-autoprint";
  const PRINTER_ASKED_STORE = "lilys-kitchen-printer-asked"; // answered "is this the printer tablet?"
  const KITCHEN_PRINTER = "192.168.1.16"; // the Epson's address on Lily's network (Kareem, 2026-10-24)
  // pickup / delivery ready times for the ticket; keep equal to data.js
  // prepMinutes / deliveryMinutes
  const READY_MIN = { pickup: 30, delivery: 40 };
  // how the page reaches the Epson (see epsonSend): HTTPS first, because an
  // https page can't call plain http in Android WebView without a Fully Kiosk
  // setting, and new UK/EU Epsons only print over HTTPS ("Secure Printing")
  const PRINTER_SCHEMES = ["https", "http"];
  const AUTO_TRIES = 3; // per order, then a person decides (a print that
  // landed but whose answer was blocked must never loop)
  // the receipt's Club box (2026-10-24: points, not the old 10% pitch). Keep
  // equal to app_config club_reward_tiers '50:500,100:1200' (club_receipt_test.ts)
  const CLUB_RUNGS = "50 points = $5 off, 100 = $12 off";
  // points this order earns: $1 of food after discounts (= club clubPoints)
  const orderPoints = (o) => {
    const sub = o.subtotal_cents ?? 0, total = o.total_cents ?? 0;
    const off = total ? sub + (o.tax_cents ?? 0) + (o.delivery_fee_cents ?? 0) + (o.tip_cents ?? 0) - total : 0;
    return Math.floor(Math.max(0, sub - Math.max(0, off)) / 100);
  };
  // QR for https://lilysmediterraneanfresh.com/club.html?src=receipt (qrcode 1.5.4,
  // error correction Q). Static on purpose: the 5% itself comes as a one-use
  // token by email after joining, so a printed QR can't be harvested.
  const CLUB_QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 41" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h41v41H0z"/><path stroke="#000000" d="M2 2.5h7m1 0h1m2 0h1m2 0h3m1 0h1m1 0h3m1 0h1m1 0h2m2 0h7M2 3.5h1m5 0h1m4 0h5m1 0h1m1 0h1m1 0h3m1 0h1m1 0h1m2 0h1m5 0h1M2 4.5h1m1 0h3m1 0h1m1 0h2m4 0h1m4 0h2m2 0h1m2 0h1m1 0h1m1 0h1m1 0h3m1 0h1M2 5.5h1m1 0h3m1 0h1m1 0h1m2 0h3m2 0h1m1 0h2m2 0h2m2 0h2m2 0h1m1 0h3m1 0h1M2 6.5h1m1 0h3m1 0h1m7 0h2m1 0h2m1 0h1m1 0h2m1 0h3m2 0h1m1 0h3m1 0h1M2 7.5h1m5 0h1m1 0h4m1 0h3m1 0h2m3 0h1m3 0h3m1 0h1m5 0h1M2 8.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M10 9.5h2m1 0h4m4 0h4m1 0h1m1 0h1M3 10.5h1m1 0h1m1 0h4m1 0h3m2 0h4m1 0h2m2 0h8m1 0h2m1 0h1M2 11.5h2m2 0h1m9 0h3m5 0h1m1 0h1m3 0h1m1 0h2m2 0h3M2 12.5h1m1 0h1m2 0h5m2 0h1m2 0h1m1 0h3m4 0h1m3 0h1m1 0h1m2 0h4M3 13.5h1m1 0h3m1 0h2m4 0h1m2 0h4m1 0h1m1 0h3m1 0h2m2 0h2m2 0h2M3 14.5h1m1 0h5m3 0h2m1 0h1m1 0h1m1 0h1m2 0h1m1 0h1m1 0h1m2 0h3m2 0h1m2 0h1M3 15.5h1m7 0h1m2 0h2m5 0h2m3 0h2m4 0h2m1 0h1m1 0h2M3 16.5h6m4 0h2m2 0h2m3 0h2m1 0h4m3 0h3m1 0h1m1 0h1M2 17.5h1m2 0h3m1 0h6m1 0h1m2 0h3m3 0h3m2 0h1m2 0h1M6 18.5h1m1 0h2m2 0h1m1 0h1m2 0h2m1 0h3m1 0h2m3 0h1m1 0h3m1 0h4M4 19.5h3m2 0h1m2 0h1m1 0h3m1 0h1m1 0h1m2 0h1m1 0h2m1 0h1m1 0h3m1 0h1m3 0h1M2 20.5h3m1 0h1m1 0h3m1 0h1m2 0h1m1 0h8m1 0h1m3 0h2m2 0h1m1 0h3M3 21.5h1m2 0h2m1 0h1m4 0h4m1 0h1m2 0h2m1 0h1m4 0h1m1 0h2m2 0h1M3 22.5h1m2 0h3m3 0h1m1 0h1m2 0h1m1 0h1m1 0h3m1 0h4m1 0h1m1 0h3m2 0h1M3 23.5h3m1 0h1m3 0h3m1 0h1m2 0h1m3 0h2m3 0h2m2 0h2m2 0h2m1 0h1M4 24.5h3m1 0h1m2 0h3m1 0h2m1 0h6m2 0h2m3 0h1m1 0h2m3 0h1M2 25.5h3m1 0h2m1 0h2m1 0h1m2 0h2m1 0h2m1 0h3m1 0h1m1 0h1m3 0h1m2 0h2M3 26.5h2m2 0h6m4 0h2m1 0h2m1 0h1m2 0h2m1 0h4m4 0h1M6 27.5h2m1 0h1m1 0h6m1 0h1m4 0h2m1 0h2m4 0h2m1 0h2m1 0h1M2 28.5h1m1 0h6m1 0h6m1 0h1m1 0h3m2 0h1m2 0h1m1 0h3m1 0h2m2 0h1M3 29.5h2m1 0h2m2 0h2m4 0h4m3 0h1m1 0h1m1 0h1m4 0h2M2 30.5h3m1 0h1m1 0h1m3 0h2m1 0h2m2 0h3m1 0h2m1 0h1m3 0h9M10 31.5h1m3 0h1m1 0h2m2 0h1m2 0h1m1 0h6m3 0h1m3 0h1M2 32.5h7m1 0h2m1 0h1m1 0h2m4 0h2m1 0h1m4 0h2m1 0h1m1 0h1m1 0h3M2 33.5h1m5 0h1m1 0h1m3 0h1m1 0h3m2 0h3m1 0h1m2 0h3m3 0h1m1 0h1M2 34.5h1m1 0h3m1 0h1m2 0h1m1 0h2m2 0h1m1 0h1m1 0h1m2 0h1m2 0h2m1 0h6M2 35.5h1m1 0h3m1 0h1m1 0h1m2 0h1m1 0h2m2 0h1m1 0h2m1 0h1m1 0h2m3 0h1m1 0h4m1 0h1M2 36.5h1m1 0h3m1 0h1m3 0h1m1 0h4m1 0h1m2 0h1m1 0h1m2 0h1m1 0h3m2 0h2m2 0h1M2 37.5h1m5 0h1m1 0h1m8 0h1m3 0h2m2 0h1m2 0h1m2 0h1M2 38.5h7m4 0h1m1 0h1m4 0h4m1 0h3m1 0h2m2 0h1m1 0h1m1 0h2"/></svg>';
  const POLL_MS = 5000;
  const OFFLINE_BANNER_AFTER_MS = 45000;
  const RECALL_WINDOW_MS = 60 * 60 * 1000;
  const REMIND_EVERY_MS = 30000;
  const CLOSED_POLL_MS = 60000; // slow down overnight — saves battery + function quota
  // age thresholds per state, minutes → [warn, late]
  const AGE = { paid: [3, 6], making: [12, 18], ready: [10, 20] };
  // Florida-time opening hours — keep in sync with data.js HOURS (0=Sun..6=Sat)
  const HOURS = { 0: [11, 21.5], 1: [11, 21.5], 2: [11, 21.5], 3: null, 4: [11, 21.5], 5: [11, 22], 6: [11, 22] };
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
  // ...&printer=192.168.1.16 also sets up this device as the one that prints
  const hashPrinter = new URLSearchParams(location.hash.slice(1)).get("printer") || "";
  if (/^[\w.:-]+$/.test(hashPrinter)) {
    try { localStorage.setItem(EPSON_STORE, hashPrinter); localStorage.setItem(AUTOPRINT_STORE, "1"); } catch { /* fine */ }
  }
  let key = hashKey || localStorage.getItem(KEY_STORE) || "";
  let orders = [];
  let pausedUntil = null; // ISO, from every list poll; null = taking online orders
  let loyalty = null; // {every, cents} when the loyalty reward is on (kitchen-api list)
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
      // iPad: Safari plays web audio as "ambient", which silent mode mutes.
      // "playback" rings through it, like a music app (Safari 16.4+).
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* older Safari */ }
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.onstatechange = () => updateShell(); // sound banner follows ctx state
      } catch { /* no audio available */ }
    }
    if (audioCtx?.state === "suspended") audioCtx.resume();
  };
  // Kareem, 2026-10-18: staff barely heard the old soft sine chime over the
  // grill. Square waves carry over kitchen noise; the compressor lets it run
  // near full scale without clipping. `rounds` = how many ding-dongs.
  const chime = (gain = 0.7, rounds = 3) => {
    if (!soundReady()) return;
    const out = audioCtx.createDynamicsCompressor();
    out.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    for (let r = 0; r < rounds; r++) {
      [[880, 0], [1174.66, 0.16]].forEach(([f, dt]) => {
        const at = t0 + r * 0.6 + dt;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = f;
        o.type = "square";
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
        o.connect(g).connect(out);
        o.start(at);
        o.stop(at + 0.45);
      });
    }
  };
  // reminder while anything sits un-started (full alarm once a ticket is
  // overdue-red) — no modal ack anywhere
  const syncReminder = () => {
    const anyNew = orders.some((o) => o.status === "paid");
    if (anyNew && !remindTimer) {
      remindTimer = setInterval(() => {
        const anyLate = orders.some((o) => o.status === "paid" && ageClass(o) === "age-late");
        chime(anyLate ? 0.7 : 0.5, anyLate ? 3 : 2);
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
      const res = await call({ action: "list" });
      const list = res.orders;
      pausedUntil = res.paused_until || null;
      loyalty = res.loyalty || null;
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
      autoPrint();
      maybeAutoTour();
      maybeAskPrinter();
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
        <div class="t-hint">${printOnStart() && !epsonAddr() ? "Tap to start + print" : "Tap to start"}${printBtn(o)}</div>
      </div>`;
    }
    return `<div class="t">
      ${band}<div class="t-body">${items}${notes}${del}${tipNote}</div>${meta}
      <div class="t-actions">
        <button class="t-go" data-ready="${o.id}">Ready</button>
        ${printBtn(o)}
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
        ${printBtn(o)}
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
          <button class="k-tool${pausedUntil ? " paused" : ""}" id="kPause" title="Pause online orders">⏸</button>
          <button class="k-tool" id="kStock" title="Mark items out of stock">86</button>
          <button class="k-tool" id="kPromo" title="Switch offers on and off">%</button>
          <button class="k-tool" id="kPrinter" title="Receipt printer">🖨</button>
          <button class="k-tool" id="kHelp" title="How to use this screen">?</button>
          <button class="k-tool" id="kFull" title="Fullscreen" ${document.fullscreenElement ? "hidden" : ""}>⛶</button>
          <span class="k-clock" id="kClock">${clock(new Date())}</span>
        </div>
      </div>
      ${soundReady() ? "" : '<div class="k-banner sound" id="kSoundBanner">🔕 Tap anywhere to enable the new-order sound</div>'}
      ${batteryLow() ? `<div class="k-banner offline">🔋 Tablet battery at ${Math.round(battery.level * 100)}% and not charging — plug it in or the board goes dark</div>` : ""}
      ${pausedUntil ? `<div class="k-banner paused">⏸ ONLINE ORDERS PAUSED ${pauseLabel(pausedUntil)} <button id="kResume">Resume</button></div>` : ""}
      ${autoErr && autoPrintOn() ? `<div class="k-banner offline">🖨 ${esc(autoErr)}. <button id="kPrintRetry">Try again</button></div>` : ""}
      ${printNote ? `<div class="k-banner ${printNote.ok ? "print-ok" : "offline"}">🖨 ${esc(printNote.text)}</div>` : ""}
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
    document.getElementById("kPrinter")?.addEventListener("click", () => openPrinter());
    document.getElementById("kPrintRetry")?.addEventListener("click", () => { autoRetryAt = 0; autoPrint(); });
    document.getElementById("kPause")?.addEventListener("click", openPause);
    document.getElementById("kResume")?.addEventListener("click", () => setPause("resume"));
    document.getElementById("kHelp")?.addEventListener("click", () => startTour());
    document.getElementById("kFull")?.addEventListener("click", () => document.documentElement.requestFullscreen?.().catch(() => {}));
    document.getElementById("kUndoBtn")?.addEventListener("click", doUndo);
  }

  /* ---- pause online orders (2026-10-15) ---------------------------------
     Kareem asked how to stop online orders for a while. The server holds the
     pause (kitchen-api "pause", app_config orders_paused_until) and
     create-checkout refuses while it runs; this is only the switch. Orders
     already placed still ring and show as normal. */
  const FOREVER = Date.parse("2900-01-01T00:00:00Z");
  function pauseLabel(iso) {
    const t = Date.parse(iso);
    if (t >= FOREVER) return "UNTIL YOU RESUME";
    if (t - Date.now() > 3 * 3600 * 1000) return "FOR THE REST OF TODAY";
    return `UNTIL ${clock(new Date(t)).toUpperCase()}`;
  }

  function openPause() {
    let wrap = document.getElementById("kPauseWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "kPauseWrap";
      document.body.appendChild(wrap);
    }
    wrap.innerHTML = `<div class="k-sheet"><div class="k-sheet-head">
        <h2>Pause online orders</h2><button class="k-sheet-x" id="kPauseX">Close</button>
      </div>
      <div class="k-sheet-body">
        <p class="k-sheet-note">${pausedUntil
          ? `Online orders are paused ${pauseLabel(pausedUntil).toLowerCase()}.`
          : "The website stops taking orders straight away. Orders already placed still show here as normal."}</p>
        <div class="k-pause-opts">
          ${pausedUntil ? '<button class="resume" data-pause="resume">Resume online orders</button>' : ""}
          <button data-pause="20">20 minutes</button>
          <button data-pause="60">1 hour</button>
          <button data-pause="today">Rest of today</button>
          <button data-pause="on">Until I resume</button>
        </div>
        <p class="k-sheet-note" id="kPauseErr" hidden></p>
      </div></div>`;
    document.getElementById("kPauseX").addEventListener("click", () => wrap.remove());
    wrap.querySelectorAll("[data-pause]").forEach((b) => b.addEventListener("click", () => setPause(b.dataset.pause)));
  }

  async function setPause(mode) {
    try {
      const r = await call({ action: "pause", mode });
      pausedUntil = r.paused_until || null;
      document.getElementById("kPauseWrap")?.remove();
      renderBoard();
    } catch (e) {
      if (e.auth) { document.getElementById("kPauseWrap")?.remove(); logout(e.message); return; }
      const err = document.getElementById("kPauseErr");
      if (err) { err.hidden = false; err.textContent = "Couldn't change it. Check the connection and try again."; }
    }
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
      // buy_qty is the whole group (paid + free): 2 and 1 = buy one, get one free
      const paid = p.buy_qty - p.free_qty;
      what = paid === 1 && p.free_qty === 1
        ? "Buy one, get one free"
        : `Buy ${paid}, get ${p.free_qty} free`;
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
      text: "Tap the ♪ button at the top to hear the new-order chime. Too quiet? Press the iPad's volume-up button until it's loud. If you ever see a yellow \"Tap anywhere\" bar, tap the screen once so the sound can play." },
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
      text: "Every order has a ··· button: print the receipt, go back a step, call the customer, or cancel. Cancelling does NOT refund the customer. Refunds are done in Stripe." },
    { id: "stock", title: "Run out of something?",
      text: "Tap 86 at the top, then tap the dish. It disappears from the website straight away. Tap it again when it's back." },
    { id: "pause", title: "Too busy?",
      text: "Tap ⏸ at the top to pause online orders for 20 minutes, an hour, the rest of today, or until you resume. Tap Resume to start taking them again." },
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
        if (e.target.closest("a, button")) return; // phone link, print button
        const o = orders.find((x) => x.id === card.dataset.start);
        act(card.dataset.start, "making", { label: `${o?.code ?? ""} started` });
        // inside the tap itself: iPad Safari only opens the print menu from a tap
        if (o && o !== practice && printOnStart() && !epsonAddr()) printReceipts([o]);
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
    board.querySelectorAll("[data-print]").forEach((b) =>
      b.addEventListener("click", () => {
        const o = orders.find((x) => x.id === b.dataset.print);
        if (o) printOrder(o);
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
        <button class="plain" id="sheetPrint">${o.printed_at ? "Reprint" : "Print"} receipt</button>
        ${refundLink}
        <button class="danger" id="sheetCancel">Cancel this order</button>
        <button class="plain" id="sheetClose">Never mind</button>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector("#sheetClose").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#sheetPrint").addEventListener("click", () => { wrap.remove(); printOrder(o); });
    wrap.querySelector("#sheetCancel").addEventListener("click", () => {
      wrap.remove();
      act(id, "canceled", { undoable: false });
    });
  }


  /* ---- receipts (2026-10-20) --------------------------------------------
     Kareem connected a receipt printer to the iPad. A web page can't drive a
     printer directly, so receipts go through the iPad's own print menu
     (AirPrint): ··· → Print receipt on any order, or switch on "print when I
     start an order" so tapping a new ticket prints it too. The receipt is
     built into #kPrintArea, which only shows when printing (kitchen.html). */
  const printOnStart = () => { try { return localStorage.getItem(PRINT_STORE) === "1"; } catch { return false; } };
  // paid time + the website's promised wait, on Florida's clock
  const readyBy = (o) => new Date(new Date(o.paid_at || o.created_at).getTime() +
    READY_MIN[o.fulfilment === "delivery" ? "delivery" : "pickup"] * 60000)
    .toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const flStamp = (iso) => new Date(iso).toLocaleString("en-US",
    { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // 9077827576 or +19077827576 -> (907) 782-7576; anything else as typed
  const usPhone = (p) => {
    const d = String(p ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p ?? "");
  };

  function receiptHTML(o) {
    const row = (l, r, cls = "") => `<div class="r-row${cls ? " " + cls : ""}"><span>${l}</span><span>${r}</span></div>`;
    const items = (o.items || []).map((l) =>
      row(`${l.qty}× ${esc(l.name)}`, l.unit_cents != null ? money(l.unit_cents * l.qty) : "") +
      (l.addons?.length ? `<div class="r-add">+ ${l.addons.map((a) => esc(a.name)).join(", ")}</div>` : "")).join("");
    const sub = o.subtotal_cents ?? 0, tax = o.tax_cents ?? 0, del = o.delivery_fee_cents ?? 0,
      tip = o.tip_cents ?? 0, total = o.total_cents ?? 0;
    const off = sub + tax + del + tip - total; // discounts aren't sent to the board; the total already has them
    const totals = total ? [
      row("Subtotal", money(sub)),
      off > 0 ? row("Discount", "−" + money(off)) : "",
      row("Tax", money(tax)),
      del ? row("Delivery", money(del)) : "",
      tip ? row("Tip", money(tip)) : "",
      row("TOTAL", money(total), "r-total"),
      `<div class="r-c">PAID ONLINE</div>`,
    ].join("") : "";
    // loyalty progress (kitchen-api counts it; the hash never reaches here)
    const L = o.loyalty && loyalty ? o.loyalty : null;
    const reward = loyalty ? `$${(loyalty.cents / 100).toFixed(loyalty.cents % 100 ? 2 : 0)}` : "";
    const loyal = !L ? "" : Math.floor(L.n / loyalty.every) - L.used > 0
      ? `<div class="r-c r-loyal">★ Your next online order is ${reward} off ★</div>`
      : `<div class="r-c r-loyal">Online order ${L.n % loyalty.every} of ${loyalty.every}: then ${reward} off</div>`;
    const delivery = o.fulfilment === "delivery";
    return `<div class="r-receipt">
      <div class="r-c r-name">Lily's Mediterranean Fresh Grill</div>
      <div class="r-c">2 5th Ave STE C</div>
      <div class="r-c">Indialantic, FL 32903</div>
      <div class="r-c">(321) 312-4444</div>
      <div class="r-hr"></div>
      <div class="r-c r-big">${esc(o.code)}</div>
      <div class="r-c r-kind">${delivery ? "DELIVERY" : "PICKUP"}${o.demo ? " · TEST" : ""}</div>
      <div class="r-c">${flStamp(o.created_at)}</div>
      <div class="r-c r-kind">${delivery ? "DELIVER" : "READY"} BY ${readyBy(o)}</div>
      <div class="r-hr"></div>
      <div>${esc(o.customer_name)}${o.customer_phone ? ` · ${esc(usPhone(o.customer_phone))}` : ""}</div>
      ${delivery && o.delivery_address ? `<div>${esc(o.delivery_address)}</div>` : ""}
      <div class="r-hr"></div>
      ${items}
      ${o.notes ? `<div class="r-notes">${esc(o.notes)}</div>` : ""}
      ${totals ? `<div class="r-hr"></div>${totals}` : ""}
      ${loyal}
      ${o.demo && !o.club ? "" : `<div class="r-club">
        <div class="r-c r-club-h">LILY'S CLUB</div>
        <div class="r-c r-club-big">${orderPoints(o) ? `+${orderPoints(o)} POINTS` : "EARN POINTS"}</div>
        <div class="r-c">${orderPoints(o) ? "from this order" : "on every online order"} · ${CLUB_RUNGS}</div>
        <div class="r-qr">${CLUB_QR}</div>
        <div class="r-c">Scan and sign in with the email you paid with. Your points are already there.</div>
      </div>`}
      <div class="r-hr"></div>
      <div class="r-c">Thank you! Order again at</div>
      <div class="r-c">lilysmediterraneanfresh.com</div>
    </div>`;
  }

  function printReceipts(list) {
    let area = document.getElementById("kPrintArea");
    if (!area) {
      area = document.createElement("div");
      area.id = "kPrintArea";
      document.body.appendChild(area);
    }
    area.innerHTML = list.map(receiptHTML).join("");
    try { window.print(); } catch { /* no print support on this device */ }
  }

  /* ---- Epson printer (2026-10-24) ---------------------------------------
     Kareem's kitchen: Android tablet in Fully Kiosk + Epson TM-m30II-NT on the
     same network. The page talks to the printer directly with Epson's
     ePOS-Print XML (no app, no driver). Only the device that has a printer
     address set prints; on it, every new paid order prints by itself once:
     printed_at is claimed on the server before the ticket is sent, so a
     refresh or a second tablet can't print it again. */
  // Android = the Fully Kiosk tablet: its own print menu can't reach the Epson,
  // so it always uses Lily's printer unless an address was typed in
  const isAndroid = /Android/i.test(navigator.userAgent);
  const epsonAddr = () => {
    let a = "";
    try { a = localStorage.getItem(EPSON_STORE) || ""; } catch { /* fine */ }
    return a || (isAndroid ? KITCHEN_PRINTER : "");
  };
  const autoPrintOn = () => { try { return !!epsonAddr() && localStorage.getItem(AUTOPRINT_STORE) === "1"; } catch { return false; } };
  const isPractice = (o) => String(o.id).startsWith("practice-");
  const printBtn = (o) => isPractice(o) ? ""
    : `<button class="t-print" data-print="${o.id}">${o.printed_at ? "Reprint" : "Print"}</button>`;

  // the printer's own error codes, in kitchen words
  const EPSON_ERRORS = {
    EPTR_REC_EMPTY: "out of paper", EPTR_COVER_OPEN: "cover is open", EPTR_CUTTER: "paper is jammed in the cutter",
    EPTR_MECHANICAL: "mechanical error, switch it off and on", EX_TIMEOUT: "printer is busy or offline",
    DeviceNotFound: "printer not found", EX_ENPC_TIMEOUT: "printer is busy",
  };

  // 48 characters a line on 80mm paper (font A). ASCII only: the default code
  // page prints accents and symbols as junk.
  const W = 48;
  const ascii = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[×]/g, "x")
    .replace(/[‒-―−]/g, "-").replace(/[^\x20-\x7e\n]/g, "");
  const wrapText = (t, width = W, indent = "") => {
    const out = [];
    for (const para of ascii(t).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        if (!line) line = (out.length ? indent : "") + word;
        else if ((line + " " + word).length <= width) line += " " + word;
        else { out.push(line); line = indent + word; }
        while (line.length > width) { out.push(line.slice(0, width)); line = indent + line.slice(width); }
      }
      out.push(line);
    }
    return out;
  };
  // left text wrapped, right text on the first line's right edge
  const lr = (left, right = "") => {
    const lines = wrapText(left, W - right.length - 1, "   ");
    lines[0] = lines[0].padEnd(W - right.length) + right;
    return lines.join("\n") + "\n";
  };
  const xe = (t) => ascii(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\n/g, "&#10;");
  const HR = "-".repeat(W) + "\n";

  function receiptXML(o) {
    const delivery = o.fulfilment === "delivery";
    const t = (body, attrs = "") => `<text${attrs}>${xe(body)}</text>`;
    const big = (body) => `<text dw="true" dh="true" em="true">${xe(body)}</text><text dw="false" dh="false" em="false"/>`;
    const parts = [
      '<text lang="en" smooth="true"/>',
      '<text align="center"/>',
      t("Lily's Mediterranean Fresh Grill\n", ' em="true"'), '<text em="false"/>',
      t("2 5th Ave STE C, Indialantic, FL 32903\n(321) 312-4444\n"),
      t(HR),
      big(`${o.code}\n`),
      big(`${delivery ? "DELIVERY" : "PICKUP"}${o.demo ? " TEST" : ""}\n`),
      t(`Ordered ${flStamp(o.created_at)}\n`),
      `<text em="true">${xe(`${delivery ? "Deliver" : "Ready"} by ${readyBy(o)}\n`)}</text><text em="false"/>`,
      '<text align="left"/>',
      t(HR),
      `<text em="true">${xe(wrapText(o.customer_name || "").join("\n") + "\n")}</text><text em="false"/>`,
      o.customer_phone ? t(usPhone(o.customer_phone) + "\n") : "",
      delivery && o.delivery_address ? t(wrapText(o.delivery_address +
        (o.delivery_miles != null ? ` (${Number(o.delivery_miles).toFixed(1)} mi)` : "")).join("\n") + "\n") : "",
      t(HR),
    ];
    for (const l of o.items || []) {
      parts.push(`<text em="true">${xe(lr(`${l.qty}x ${l.name}`, l.unit_cents != null ? money(l.unit_cents * l.qty) : ""))}</text><text em="false"/>`);
      for (const a of l.addons || []) parts.push(t(wrapText(`+ ${a.name}`, W - 3, "  ").map((s) => "   " + s).join("\n") + "\n"));
    }
    if (o.notes) parts.push(t(HR), `<text reverse="true" em="true">${xe(" NOTE ")}</text><text reverse="false"/>`,
      `<text em="true">${xe("\n" + wrapText(o.notes).join("\n") + "\n")}</text><text em="false"/>`);
    const sub = o.subtotal_cents ?? 0, tax = o.tax_cents ?? 0, del = o.delivery_fee_cents ?? 0,
      tip = o.tip_cents ?? 0, total = o.total_cents ?? 0;
    const off = sub + tax + del + tip - total; // same sum as the screen receipt
    if (total) {
      parts.push(t(HR), t(lr("Subtotal", money(sub))));
      if (off > 0) parts.push(t(lr("Discount", "-" + money(off))));
      parts.push(t(lr("Tax", money(tax))));
      if (del) parts.push(t(lr("Delivery", money(del))));
      if (tip) parts.push(t(lr(delivery ? "Driver tip" : "Tip", money(tip))));
      parts.push(`<text em="true">${xe(lr("TOTAL", money(total)))}</text><text em="false"/>`,
        '<text align="center"/>', t("PAID ONLINE\n"));
    }
    parts.push('<text align="center"/>');
    const L = o.loyalty && loyalty ? o.loyalty : null;
    if (L) {
      const reward = `$${(loyalty.cents / 100).toFixed(loyalty.cents % 100 ? 2 : 0)}`;
      parts.push(t(Math.floor(L.n / loyalty.every) - L.used > 0
        ? `* Your next online order is ${reward} off *\n`
        : `Online order ${L.n % loyalty.every} of ${loyalty.every}: then ${reward} off\n`));
    }
    if (!o.demo || o.club) {
      const pts = orderPoints(o);
      parts.push(t(HR), t("LILY'S CLUB\n", ' em="true"'), '<text em="false"/>',
        big(pts ? `+${pts} POINTS\n` : "EARN POINTS\n"),
        t(`${pts ? "from this order" : "on every online order"}\n${CLUB_RUNGS}\n`),
        '<symbol type="qrcode_model_2" level="level_q" width="5">https://lilysmediterraneanfresh.com/club.html?src=receipt</symbol>',
        t("\n" + wrapText("Scan and sign in with the email you paid with. Your points are already there.").join("\n") + "\n"));
    }
    parts.push(t(HR), t("Thank you! Order again at\nlilysmediterraneanfresh.com\n"), '<feed line="2"/>', '<cut type="feed"/>');
    return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${parts.join("")}</epos-print>`;
  }

  // One POST of ePOS-Print XML. No custom headers on purpose: a plain
  // text/plain POST is a "simple" request, so there's no CORS preflight for
  // the printer to answer (same as Odoo's Epson driver).
  async function epsonPost(base, inner) {
    const body = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
      inner + "</s:Body></s:Envelope>";
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let r;
    try {
      r = await fetch(`${base}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`, { method: "POST", body, signal: ctl.signal });
    } catch {
      throw Object.assign(new Error("can't reach the printer"), { unreachable: true });
    } finally { clearTimeout(timer); }
    const text = await r.text().catch(() => "");
    if (/success="true"/.test(text)) return;
    const code = (text.match(/code="([^"]*)"/) || [])[1] || (r.ok ? "" : `HTTP ${r.status}`);
    throw new Error(EPSON_ERRORS[code] || `printer said ${code || "no"}`);
  }

  // the saved address carries the scheme that worked in the test print
  const epsonBase = (addr = epsonAddr()) => /^https?:\/\//.test(addr) ? addr : `${PRINTER_SCHEMES[0]}://${addr}`;
  async function epsonSend(inner) {
    if (!epsonAddr()) throw new Error("no printer set");
    await epsonPost(epsonBase(), inner);
  }

  // test print only: try each scheme and keep the one that answers. Never in
  // the auto path, where a second attempt could print the ticket twice.
  async function epsonFind(inner) {
    const host = epsonAddr().replace(/^https?:\/\//, "");
    let last;
    for (const scheme of PRINTER_SCHEMES) {
      try {
        await epsonPost(`${scheme}://${host}`, inner);
        try { localStorage.setItem(EPSON_STORE, `${scheme}://${host}`); } catch { /* fine */ }
        return scheme;
      } catch (e) {
        last = e;
        if (!e.unreachable) throw e; // the printer answered: paper, cover, etc.
      }
    }
    throw last;
  }

  // Print / Reprint button and the ··· sheet: always prints, and marks the
  // order printed so auto-print leaves it alone afterwards
  let printNote = null; // {text, ok} shown in the shell for a few seconds
  const notePrint = (text, ok) => {
    printNote = { text, ok };
    updateShell();
    setTimeout(() => { if (printNote?.text === text) { printNote = null; updateShell(); } }, ok ? 4000 : 12000);
  };
  async function printOrder(o) {
    if (!epsonAddr()) { printReceipts([o]); return; } // iPad / AirPrint path
    notePrint(`Printing ${o.code}...`, true);
    try {
      await epsonSend(receiptXML(o));
      notePrint(`Printed ${o.code}`, true);
      if (!isPractice(o)) {
        o.printed_at = o.printed_at || new Date().toISOString();
        call({ action: "print_claim", id: o.id }).catch(() => {});
        renderBoard();
      }
    } catch (e) {
      notePrint(`${o.code} did not print: ${e.message}`, false);
    }
  }

  // new paid orders, once each, on the printing device only
  let autoBusy = false;
  let autoRetryAt = 0;
  let autoErr = "";
  const autoFails = new Map(); // order id -> failed auto attempts
  async function autoPrint() {
    if (!autoPrintOn() || autoBusy || Date.now() < autoRetryAt) return;
    const due = orders.filter((o) => !isPractice(o) && !o.printed_at && ["paid", "making", "ready"].includes(o.status) &&
      Date.now() - new Date(o.paid_at || o.created_at).getTime() < 3 * 3600 * 1000);
    if (!due.length) return;
    autoBusy = true;
    try {
      for (const o of due) {
        const { claimed } = await call({ action: "print_claim", id: o.id });
        o.printed_at = new Date().toISOString();
        if (!claimed) continue; // printed already, by this tablet before a refresh or by another one
        try {
          await epsonSend(receiptXML(o));
          if (autoErr) { autoErr = ""; updateShell(); }
        } catch (e) {
          const n = (autoFails.get(o.id) || 0) + 1;
          autoFails.set(o.id, n);
          if (n < AUTO_TRIES) {
            o.printed_at = null;
            autoErr = `${o.code} didn't print: ${e.message}. It prints by itself once the printer is fixed`;
            await call({ action: "print_release", id: o.id }).catch(() => {});
          } else {
            // stays claimed: check the printer, then tap Reprint on the ticket
            autoErr = `${o.code} didn't print ${n} times (${e.message}). Fix the printer, then tap Reprint on ${o.code}`;
          }
          autoRetryAt = Date.now() + 20000;
          updateShell();
          break;
        }
      }
    } catch { /* offline: next poll tries again */ } finally {
      autoBusy = false;
      renderBoard();
    }
  }

  // First open on a device with no printer set: ask once whether this is
  // the tablet next to the Epson. Yes sets it up and prints a test straight
  // away, so the kitchen never needs a setup link. Waits for the tutorial.
  function maybeAskPrinter() {
    let asked = "";
    try { asked = localStorage.getItem(PRINTER_ASKED_STORE) || ""; } catch { return; }
    let auto = "";
    try { auto = localStorage.getItem(AUTOPRINT_STORE) || ""; } catch { /* fine */ }
    if (asked || auto || tour || document.querySelector(".k-sheet-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "k-sheet-wrap";
    wrap.innerHTML = `
      <div class="k-sheet">
        <h3>Receipt printer</h3>
        <p class="warn">Is this the tablet next to the receipt printer?</p>
        <button class="go" id="askYes">Yes, set up printing</button>
        <button class="plain" id="askNo">No, not this one</button>
      </div>`;
    const answer = (yes) => {
      try {
        localStorage.setItem(PRINTER_ASKED_STORE, yes ? "yes" : "no");
        if (yes) { localStorage.setItem(EPSON_STORE, KITCHEN_PRINTER); localStorage.setItem(AUTOPRINT_STORE, "1"); }
      } catch { /* fine */ }
      wrap.remove();
      if (yes) { lastSnapshot = ""; renderBoard(); openPrinter({ test: true }); }
    };
    wrap.querySelector("#askYes").addEventListener("click", () => answer(true));
    wrap.querySelector("#askNo").addEventListener("click", () => answer(false));
    document.body.appendChild(wrap);
  }

  function openPrinter({ test = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "k-sheet-wrap";
    const paint = (status = "") => {
      const addr = epsonAddr();
      const on = printOnStart();
      wrap.innerHTML = `
        <div class="k-sheet">
          <h3>Receipt printer</h3>
          <label class="warn" for="prAddr">Epson printer address (leave empty on an iPad to use its print menu)</label>
          <input id="prAddr" class="k-pr-addr" inputmode="decimal" autocomplete="off" placeholder="${KITCHEN_PRINTER}" value="${esc(addr)}">
          <button class="plain" id="prSave">Save address</button>
          ${addr ? `
            <button class="${autoPrintOn() ? "go" : "plain"}" id="prAuto">Print new orders automatically: ${autoPrintOn() ? "ON" : "OFF"}</button>
            <p class="warn">Only switch this on for the one tablet next to the printer.</p>`
          : `
            <p class="warn">Receipts print through the iPad's print menu. The first time, tap <b>Printer</b> in that menu and pick yours; the iPad remembers it after that.</p>
            <button class="${on ? "go" : "plain"}" id="prToggle">Print when I start an order: ${on ? "ON" : "OFF"}</button>`}
          <button class="plain" id="prTest">Print a test receipt</button>
          ${status ? `<p class="warn" id="prStatus">${esc(status)}</p>` : ""}
          <button class="plain" id="prClose">Done</button>
        </div>`;
      wrap.querySelector("#prSave").addEventListener("click", () => {
        const v = wrap.querySelector("#prAddr").value.trim().replace(/\/+$/, "");
        try {
          if (v) localStorage.setItem(EPSON_STORE, v);
          else { localStorage.removeItem(EPSON_STORE); localStorage.removeItem(AUTOPRINT_STORE); }
        } catch { /* fine */ }
        paint(v ? "Saved. Tap Print a test receipt." : "Printer address removed.");
        lastSnapshot = "";
        renderBoard();
      });
      wrap.querySelector("#prAuto")?.addEventListener("click", () => {
        try { localStorage.setItem(AUTOPRINT_STORE, autoPrintOn() ? "0" : "1"); } catch { /* fine */ }
        paint();
        autoRetryAt = 0;
        autoPrint();
      });
      wrap.querySelector("#prToggle")?.addEventListener("click", () => {
        try { localStorage.setItem(PRINT_STORE, on ? "0" : "1"); } catch { /* fine */ }
        paint();
        lastSnapshot = ""; // repaint the "Tap to start + print" hints
        renderBoard();
      });
      wrap.querySelector("#prTest").addEventListener("click", async () => {
        const now = new Date().toISOString();
        const test = {
          id: "test-print", code: "TEST-PRINT", demo: true, club: true, customer_name: "Printer test", customer_phone: "3213124444", fulfilment: "pickup",
          items: [{ qty: 1, name: "Chicken Shawarma Wrap", unit_cents: 1715, addons: [{ name: "Seasoned Fries" }, { name: "Extra garlic sauce" }] },
            { qty: 2, name: "Falafel", unit_cents: 770 }],
          notes: "If you can read this, the printer works.", created_at: now, paid_at: now,
          subtotal_cents: 3255, tax_cents: 228, total_cents: 3483,
        };
        if (!epsonAddr()) { printReceipts([test]); return; }
        paint("Printing...");
        try {
          const scheme = await epsonFind(receiptXML(test));
          paint(`Printed (${scheme}). Check the paper.`);
        } catch (e) {
          paint(e.unreachable
            ? "Can't reach the printer. Check the address. In Fully Kiosk: Settings > Advanced Web Settings > switch on Ignore SSL Errors, set Mixed Content Mode to Always Allow, then try again."
            : `The printer answered but didn't print: ${e.message}.`);
        }
      });
      wrap.querySelector("#prClose").addEventListener("click", () => wrap.remove());
    };
    paint();
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    if (test) wrap.querySelector("#prTest").click();
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
