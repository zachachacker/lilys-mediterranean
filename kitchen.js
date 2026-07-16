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
  const POLL_MS = 5000;
  const OFFLINE_BANNER_AFTER_MS = 45000;
  const RECALL_WINDOW_MS = 60 * 60 * 1000;
  const REMIND_EVERY_MS = 30000;
  // age thresholds per state, minutes → [warn, late]
  const AGE = { paid: [3, 6], making: [12, 18], ready: [10, 20] };

  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const telHref = (s) => "tel:" + String(s ?? "").replace(/[^+\d]/g, "");
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const clock = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  let key = localStorage.getItem(KEY_STORE) || "";
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
  // soft reminder while anything sits un-started — no modal ack anywhere
  const syncReminder = () => {
    const anyNew = orders.some((o) => o.status === "paid");
    if (anyNew && !remindTimer) remindTimer = setInterval(() => chime(0.22), REMIND_EVERY_MS);
    if (!anyNew && remindTimer) { clearInterval(remindTimer); remindTimer = 0; }
  };

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
    if (r.status === 401) throw Object.assign(new Error("Wrong kitchen key"), { auth: true });
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
      orders = list;
      firstLoad = false;
      lastOkAt = Date.now();
      failCount = 0;
      syncReminder();
      renderBoard();
    } catch (e) {
      if (e.auth) { logout(e.message); return; }
      failCount++;
      updateShell(); // flip the dot / offline banner, keep the board intact
    }
    schedulePoll();
  };

  const schedulePoll = () => {
    clearTimeout(pollTimer);
    const delay = failCount === 0 ? POLL_MS : Math.min(5000 * 2 ** (failCount - 1), 30000);
    pollTimer = setTimeout(refresh, delay);
  };

  const stopEverything = () => {
    clearTimeout(pollTimer);
    clearInterval(remindTimer);
    remindTimer = 0;
  };

  /* -------------------------------------------- actions (optimistic) ---- */
  const act = async (id, to, { undoable = true, label = "" } = {}) => {
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
      .map((l) => `<div class="t-item"><b>${l.qty}×</b><span>${esc(l.name)}</span></div>`)
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
    if (o.status === "paid") {
      return `<div class="t new ${o._fresh ? "fresh" : ""}" data-start="${o.id}">
        ${band}<div class="t-body">${items}${notes}</div>${meta}
        <div class="t-hint">Tap to start</div>
      </div>`;
    }
    return `<div class="t">
      ${band}<div class="t-body">${items}${notes}</div>${meta}
      <div class="t-actions">
        <button class="t-go" data-ready="${o.id}">Ready</button>
        <button class="t-more" data-more="${o.id}" aria-label="More options for ${esc(o.code)}">···</button>
      </div>
    </div>`;
  }

  function railCard(o) {
    return `<div class="t ready-card">
      <div class="t-band ${ageClass(o)}" data-band="${o.id}">
        <span class="t-code">${esc(o.code)}</span>
        <span class="t-right"><span class="t-timer" data-ts="${esc(o.updated_at)}" data-oid="${o.id}">${fmtTimer(o.updated_at)}</span></span>
      </div>
      <div class="t-name">${esc(o.customer_name)}</div>
      <div class="t-sub">${(o.items || []).reduce((s, l) => s + l.qty, 0)} items · <a href="${telHref(o.customer_phone)}" style="color:inherit">${esc(o.customer_phone)}</a>${o.demo ? ' · <span class="t-demo">test</span>' : ""}</div>
      <div class="t-actions">
        <button class="t-go" data-picked="${o.id}">Picked up</button>
        <button class="t-more" data-more="${o.id}" aria-label="More options for ${esc(o.code)}">···</button>
      </div>
    </div>`;
  }

  const offlineNow = () => failCount > 0 && lastOkAt && Date.now() - lastOkAt > OFFLINE_BANNER_AFTER_MS;

  function shellHTML() {
    return `
      <div class="k-head">
        <div class="k-brand">Lily<em>'s</em> Kitchen</div>
        <div class="k-head-meta">
          <span class="k-stamp" id="kStamp">updated ${lastOkAt ? clock(new Date(lastOkAt)) : "—"}</span>
          <span><i class="k-dot${failCount > 0 ? " err" : ""}"></i></span>
          ${wakeLock && !wakeLock.released ? "" : '<span title="Screen may sleep">☾</span>'}
          <button class="k-tool" id="kSound" title="Test sound">${soundReady() ? "♪" : "🔕"}</button>
          <button class="k-tool" id="kFull" title="Fullscreen" ${document.fullscreenElement ? "hidden" : ""}>⛶</button>
          <span class="k-clock" id="kClock">${clock(new Date())}</span>
        </div>
      </div>
      ${soundReady() ? "" : '<div class="k-banner sound" id="kSoundBanner">🔕 Tap anywhere to enable the new-order sound</div>'}
      ${offlineNow() ? `<div class="k-banner offline">OFFLINE — showing orders as of ${clock(new Date(lastOkAt))}. Taps are saved and will sync.</div>` : ""}`;
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
    document.getElementById("kFull")?.addEventListener("click", () => document.documentElement.requestFullscreen?.().catch(() => {}));
    document.getElementById("kUndoBtn")?.addEventListener("click", doUndo);
  }

  let lastSnapshot = "";
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
    wrap.innerHTML = `
      <div class="k-sheet">
        <h3>${esc(o.code)} · ${esc(o.customer_name)}</h3>
        ${o.demo ? "" : '<p class="warn">Canceling does NOT refund the payment — issue the refund in the Stripe dashboard.</p>'}
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
