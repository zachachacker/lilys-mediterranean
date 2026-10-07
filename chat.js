/* Ask Lily's — client-side concierge. No backend, no API keys: every answer is
   grounded in window.LILYS (the same data the site renders). It answers what it
   truly knows (hours, menu, prices, dietary tags, ordering, location) and hands
   anything unverified to the phone — it never invents restaurant facts. */
(() => {
  "use strict";
  const L = window.LILYS;
  if (!L) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /* ---------------------------------------------------------- utilities */
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9$ ]+/g, " ").replace(/\s+/g, " ").trim();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtHour = (h) => {
    const whole = Math.floor(h);
    const suffix = whole >= 12 ? "pm" : "am";
    const display = whole > 12 ? whole - 12 : whole;
    return `${display}${suffix}`;
  };
  const hoursLine = (d) => (L.HOURS[d] ? `${fmtHour(L.HOURS[d][0])}–${fmtHour(L.HOURS[d][1])}` : "Closed");

  const ITEMS = [];
  L.MENU.forEach((cat) => cat.items.forEach(([n, d, p, t]) => ITEMS.push({ n, d, p, t, cat: cat.c })));

  function findItems(q) {
    const qt = norm(q).split(" ").filter((w) => w.length > 2);
    if (!qt.length) return [];
    const scored = ITEMS.map((it) => {
      const name = norm(it.n), desc = norm(it.d);
      let score = 0;
      for (const w of qt) {
        if (name.includes(w)) score += 3;
        if (desc.includes(w)) score += 1;
      }
      if (qt.join(" ") === name) score += 6;
      return { it, score };
    }).filter((x) => x.score >= 3);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map((x) => x.it);
  }

  const itemCard = (it) =>
    `<div class="cb-item"><div class="cb-item-top"><strong>${esc(it.n)}</strong><span class="cb-price">${esc(it.p)}</span></div>` +
    `<span class="cb-item-desc">${esc(it.d)}${it.t ? ` <em class="cb-tag">${esc(it.t)}</em>` : ""}</span></div>`;

  const link = (href, text, ext) =>
    `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ""}>${esc(text)}</a>`;
  const callLink = () => link(L.phoneHref, L.phone);

  function openState() {
    const { day: d, hour: h } = L.nowInTz(); // Florida time, not the visitor's clock
    const today = L.HOURS[d];
    if (today && h >= today[0] && h < today[1]) return { open: true, until: today[1] };
    if (today && h < today[0]) return { open: false, opensAt: today[0], day: "today" };
    let n = 1;
    while (n <= 7 && !L.HOURS[(d + n) % 7]) n++;
    return { open: false, opensAt: (L.HOURS[(d + n) % 7] || [11])[0], day: n === 1 ? "tomorrow" : DAYS[(d + n) % 7] };
  }

  /* ------------------------------------------------------------ intents */
  const has = (q, words) => words.some((w) => q.includes(w));

  function answer(raw) {
    const q = norm(raw);

    if (has(q, ["hello", "hi ", "hey", "salam", "good morning", "good evening"]) && q.length < 25) {
      return { html: "Hi! I'm the Lily's helper — ask me about the menu, prices, hours, ordering or catering.", chips: ["Open now?", "What's vegan?", "Best dishes", "How do I order?"] };
    }

    if (has(q, ["open", "close", "hour", "when do", "what time", "tonight", "today"]) || DAYS.some((d) => q.includes(d.toLowerCase()))) {
      const asked = DAYS.findIndex((d) => q.includes(d.toLowerCase()));
      if (asked >= 0) {
        return { html: `<strong>${DAYS[asked]}:</strong> ${hoursLine(asked)}.`, chips: ["Open now?", "Where are you?"] };
      }
      const st = openState();
      const week = DAYS.map((d, i) => `${d.slice(0, 3)} ${hoursLine(i)}`).join(" · ");
      const line = st.open
        ? `We're <strong>open now</strong> — until ${fmtHour(st.until)} today.`
        : `We're closed right now — we open ${st.day === "today" ? "" : st.day + " "}at ${fmtHour(st.opensAt)}.`;
      return { html: `${line}<span class="cb-fine">${week}</span>`, chips: ["How do I order?", "Where are you?"] };
    }

    if (has(q, ["where", "address", "located", "location", "direction", "find you", "parking", "map"])) {
      return {
        html: `We're at <strong>${esc(L.address)}</strong> — on 5th Avenue in Indialantic, just off the beach. ${link(L.directionsUrl, "Get directions", true)}.`,
        chips: ["Open now?", "How do I order?"],
      };
    }

    if (has(q, ["cater", "party", "event", "office", "big order", "large order", "platter for"])) {
      return {
        html: `Yes — we cater! Family platters and party spreads are our thing. Call ${callLink()} or email ${link("mailto:" + L.email, L.email)} with your date, guest count and any dietary needs, and we'll sort the rest. A full catering menu is coming soon.`,
        chips: ["Family Specials", "What's gluten free?"],
      };
    }

    if (has(q, ["uber", "doordash", "door dash", "grubhub", "grub hub", "deliver"])) {
      const partners = L.delivery.partners.map(([n, u]) => link(u, n, true)).join(" · ");
      return {
        html: `Delivery comes via ${partners}. For pickup, ${link(L.orderUrl, "order right here on our site")} — it goes straight to the kitchen, ready in ~${L.ORDERING.prepMinutes} min.`,
        chips: ["Order online", "Call the kitchen"],
      };
    }

    if (has(q, ["order", "pickup", "pick up", "takeout", "take out", "online"])) {
      return {
        html: `Two ways: ${link(L.orderUrl, "order online for pickup")} — pay online, ready in ~${L.ORDERING.prepMinutes} min — or call the kitchen at ${callLink()}, great for big or custom orders.`,
        chips: ["Delivery options", "Best dishes"],
      };
    }

    if (has(q, ["vegan"])) {
      const v = ITEMS.filter((it) => it.t === "Vegan").slice(0, 6);
      return { html: `Plenty! Our vegan favourites:${v.map(itemCard).join("")}<span class="cb-fine">…and more on the ${link("menu.html", "full menu")}.</span>`, chips: ["What's gluten free?", "Vegetarian options"] };
    }
    if (has(q, ["vegetarian", "veggie"])) {
      const v = ITEMS.filter((it) => it.t === "Veg" || it.t === "Vegan").slice(0, 6);
      return { html: `Lots of vegetarian choices:${v.map(itemCard).join("")}<span class="cb-fine">Full list on the ${link("menu.html", "menu page")}.</span>`, chips: ["What's vegan?", "Best dishes"] };
    }
    if (has(q, ["gluten", " gf"])) {
      const v = ITEMS.filter((it) => it.t === "GF").slice(0, 6);
      return { html: `Our platters and bowls are the gluten-free sweet spot:${v.map(itemCard).join("")}<span class="cb-fine">Please mention gluten sensitivity when ordering.</span>`, chips: ["What's vegan?", "How do I order?"] };
    }
    if (has(q, ["halal", "kosher"])) {
      return {
        html: `Yes — our food is <strong>halal and kosher</strong>. Enjoy the whole menu with confidence.`,
        chips: ["Best dishes", "What's vegan?", "How do I order?"],
      };
    }
    if (has(q, ["allerg", "nut ", "nuts", "dairy", "sesame", "peanut", "shellfish"])) {
      return {
        html: `For specific allergens (nuts, dairy, sesame, shellfish), please call us at ${callLink()} and we'll confirm for any dish — we'd rather be sure than guess.`,
        chips: ["What's vegan?", "Is it halal?", "Menu"],
      };
    }

    if (has(q, ["recommend", "best", "popular", "favourite", "favorite", "signature", "what should", "must try", "famous"])) {
      const sigs = L.signatures.map((name) => ITEMS.find((it) => it.n === name)).filter(Boolean).slice(0, 4);
      return { html: `The ones people cross the bridge for:${sigs.map(itemCard).join("")}`, chips: ["Full menu", "How do I order?"] };
    }

    if (has(q, ["reserv", "book a table", "booking"])) {
      return {
        html: `No reservations needed — walk-ins are welcome. Bringing a big group? Give us a ring at ${callLink()} and we'll be ready for you.`,
        chips: ["Open now?", "Where are you?"],
      };
    }

    if (has(q, ["pay", "venmo", "google pay", "apple pay", "card", "cash"])) {
      return { html: `${esc(L.payments)} For anything else, ask at the counter or call ${callLink()}.`, chips: ["How do I order?"] };
    }

    if (has(q, ["phone", "number", "call", "contact", "email"])) {
      return { html: `Call us at ${callLink()} or email ${link("mailto:" + L.email, L.email)}. We love phone orders.`, chips: ["Open now?", "Where are you?"] };
    }

    if (has(q, ["menu", "what do you have", "what do you serve", "food", "dishes", "eat"])) {
      const cats = L.MENU.map((c) => c.c).join(" · ");
      return { html: `The whole spread lives on the ${link("menu.html", "menu page")} — ${esc(cats)}.`, chips: ["Best dishes", "What's vegan?"] };
    }

    if (has(q, ["thank", "cheers", "great", "bye"])) {
      return { html: "Anytime! Come hungry. 🫒", chips: ["Best dishes", "Open now?"] };
    }

    // menu item / price lookup
    const found = findItems(raw);
    if (found.length) {
      const lead = has(q, ["how much", "price", "cost", "$"]) ? "Here's what that costs:" : "Found it:";
      return { html: `${lead}${found.map(itemCard).join("")}`, chips: ["Full menu", "How do I order?"] };
    }

    return {
      html: `I'm not sure about that one — I know the menu, prices, hours, ordering, catering and where to find us. For anything else the kitchen is the boss: ${callLink()}.`,
      chips: ["Menu", "Open now?", "How do I order?"],
    };
  }

  /* ---------------------------------------------------------------- UI */
  const root = document.createElement("div");
  root.className = "cb-root";
  root.innerHTML = `
    <button class="cb-fab" id="cbFab" aria-label="Ask Lily's — chat with us" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M21 12a8 8 0 01-8 8H4l2.2-2.6A8 8 0 1121 12z"/>
        <circle cx="9" cy="12" r="0.8" fill="currentColor"/><circle cx="13" cy="12" r="0.8" fill="currentColor"/><circle cx="17" cy="12" r="0.8" fill="currentColor"/>
      </svg>
      <span class="cb-fab-label">Ask Lily's</span>
    </button>
    <section class="cb-panel" id="cbPanel" role="dialog" aria-label="Ask Lily's chat" hidden>
      <header class="cb-head">
        <div><strong>Ask Lily's</strong><span class="cb-sub" id="cbStatus"></span></div>
        <button class="cb-close" id="cbClose" aria-label="Close chat">×</button>
      </header>
      <div class="cb-msgs" id="cbMsgs" aria-live="polite"></div>
      <div class="cb-chips" id="cbChips"></div>
      <form class="cb-form" id="cbForm">
        <input id="cbInput" type="text" placeholder="Ask about the menu, hours, ordering…" autocomplete="off" maxlength="200" aria-label="Your question">
        <button class="cb-send" type="submit" aria-label="Send">→</button>
      </form>
    </section>`;
  document.body.appendChild(root);

  const fab = root.querySelector("#cbFab");
  const panel = root.querySelector("#cbPanel");
  const msgs = root.querySelector("#cbMsgs");
  const chipsEl = root.querySelector("#cbChips");
  const form = root.querySelector("#cbForm");
  const input = root.querySelector("#cbInput");
  const statusEl = root.querySelector("#cbStatus");

  const st = openState();
  statusEl.textContent = st.open ? `Open now · until ${fmtHour(st.until)}` : "Closed right now";

  function addMsg(html, who) {
    const el = document.createElement("div");
    el.className = `cb-msg ${who}`;
    el.innerHTML = html;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function setChips(list) {
    chipsEl.innerHTML = "";
    (list || []).forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c;
      b.addEventListener("click", () => ask(c));
      chipsEl.appendChild(b);
    });
  }

  function ask(text) {
    addMsg(esc(text), "user");
    setChips([]);
    const typing = addMsg('<span class="cb-dots"><i></i><i></i><i></i></span>', "bot typing");
    const { html, chips } = answer(text);
    setTimeout(() => {
      typing.classList.remove("typing");
      typing.innerHTML = html;
      msgs.scrollTop = msgs.scrollHeight;
      setChips(chips);
    }, reduce ? 60 : 450 + Math.random() * 350);
  }

  let greeted = false;
  function open() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    root.classList.add("open");
    if (!greeted) {
      greeted = true;
      addMsg("Hi! I'm the Lily's helper. Menu, prices, hours, ordering, catering — ask away.", "bot");
      setChips(["Open now?", "Best dishes", "What's vegan?", "How do I order?"]);
    }
    setTimeout(() => input.focus(), 80);
  }
  function close() {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    root.classList.remove("open");
    fab.focus();
  }

  fab.addEventListener("click", () => (panel.hidden ? open() : close()));
  root.querySelector("#cbClose").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    ask(t);
  });
})();
