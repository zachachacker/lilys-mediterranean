/* Lily's online ordering — cart + checkout (order.html) and the
   confirmation page (order-confirmed.html). Prices shown come from data.js;
   the server re-prices every order from its own menu table, so the client
   can never charge wrong amounts. */
(() => {
  "use strict";
  const L = window.LILYS;
  if (!L || !L.ORDERING) return;
  const O = L.ORDERING;
  const FN = `${O.supabaseUrl}/functions/v1`;
  const HDRS = {
    "Content-Type": "application/json",
    apikey: O.anonKey,
    Authorization: `Bearer ${O.anonKey}`,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const money = (cents) => `$${(cents / 100).toFixed(2)}`;
  // must match scripts/sync-menu.mjs
  const slug = (s) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // in-house price string -> ONLINE cents (data.js applies the 3% markup);
  // must stay in step with scripts/sync-menu.mjs, which prices the server table
  const parsePrice = (p) => {
    const m = /^\$(\d+)\.(\d{2})$/.exec(p);
    return m ? window.LILYS.onlineCents(Number(m[1]) * 100 + Number(m[2])) : null;
  };

  /* ------------------------------------------------ confirmation page ---- */
  const confirmRoot = $("confirmRoot");
  if (confirmRoot) {
    const sid = new URLSearchParams(location.search).get("sid");
    if (!sid) {
      confirmRoot.innerHTML = `<p class="confirm-error">We couldn't find that order. <a class="ink" href="order.html">Start a new one?</a></p>`;
      return;
    }
    // landing here means the order went through — now the cart can go
    try { localStorage.removeItem("lilys-cart-v1"); } catch { /* fine */ }
    const render = (o) => {
      const delivery = o.fulfilment === "delivery";
      const STEPS = [
        ["paid", "Received"],
        ["making", "On the grill"],
        ["ready", delivery ? "Out for delivery" : "Ready for pickup"],
      ];
      const items = (o.items || [])
        .map((l) => `<div class="co-line"><span>${l.qty} × ${esc(l.name)}${l.addons?.length ? `<small class="co-addons">+ ${l.addons.map((a) => esc(a.name)).join(", ")}</small>` : ""}</span><span>${money(l.unit_cents * l.qty)}</span></div>`)
        .join("");
      const pending = o.status === "pending";
      const activeIdx = o.status === "done" ? 3 : STEPS.findIndex(([s]) => s === o.status);
      const steps = STEPS.map(([s, label], i) => {
        const state = o.status === "canceled" ? "" : i <= activeIdx || (o.status === "done") ? "on" : "";
        return `<div class="co-step ${state}"><i></i>${label}</div>`;
      }).join("");
      const totalLabel = o.demo ? "Total (not charged)" : pending ? "Total" : "Total paid";
      confirmRoot.innerHTML = `
        ${o.demo ? '<div class="demo-badge">Test order — no payment was taken</div>' : ""}
        <span class="eyebrow">${pending ? "Almost there" : "Order received"} — thank you${o.customer_name ? ", " + esc(o.customer_name.split(" ")[0]) : ""}!</span>
        <h1>${pending ? "Finalizing<br>your payment…" : delivery ? "It's coming<br>to you." : "Show this code<br>at the counter."}</h1>
        <div class="confirm-code">${esc(o.code)}</div>
        ${o.status === "canceled"
          ? '<p class="confirm-error">This order was canceled. If that\'s a surprise, call us at <a class="ink" href="tel:+13213124444">(321) 312-4444</a>.</p>'
          : pending
          ? '<p class="confirm-sub">Confirming your payment with the bank — this usually takes a few seconds. Keep this page open.</p>'
          : delivery
          ? `<div class="co-steps">${steps}</div>
             <p class="confirm-sub">On its way in about <strong>${esc(O.deliveryMinutes)} minutes</strong> to ${esc(o.delivery_address || "your address")}.
             Questions? <a class="ink" href="${L.phoneHref}">${L.phone}</a></p>`
          : `<div class="co-steps">${steps}</div>
             <p class="confirm-sub">Ready in about <strong>${esc(O.prepMinutes)} minutes</strong> at 2 5th Ave STE C, Indialantic.
             We'll email you the moment it's ready.
             <a class="ink" href="${L.directionsUrl}" target="_blank" rel="noopener">Directions</a> · <a class="ink" href="${L.phoneHref}">${L.phone}</a></p>`}
        ${o.status === "done" ? rateHTML(o) : ""}
        ${o.referral ? shareHTML(o.referral) : ""}
        <div class="co-receipt">
          ${items}
          <div class="co-line co-sub"><span>Subtotal</span><span>${money(o.subtotal_cents)}</span></div>
          ${o.discount_cents > 0 ? `<div class="co-line co-sub"><span>Offers</span><span>−${money(o.discount_cents)}</span></div>` : ""}
          <div class="co-line co-sub"><span>Tax</span><span>${money(o.tax_cents)}</span></div>
          ${o.delivery_fee_cents > 0 ? `<div class="co-line co-sub"><span>Delivery</span><span>${money(o.delivery_fee_cents)}</span></div>` : ""}
          ${o.tip_cents > 0 ? `<div class="co-line co-sub"><span>${delivery ? "Driver tip" : "Tip"}</span><span>${money(o.tip_cents)}</span></div>` : ""}
          <div class="co-line co-total"><span>${totalLabel}</span><span>${money(o.total_cents)}</span></div>
        </div>`;
    };
    // refer a friend: the customer's own link (server-made, held off until
    // Kareem turns it on). The token rides the #fragment, never the query.
    const shareUrl = (r) => `${location.origin}/order.html?src=referral#r=${r.token}`;
    function shareHTML(r) {
      return `<div class="co-share">
        <p class="co-rate-t">Give a friend ${r.percent}% off their first order, and get ${r.percent}% off your next one.</p>
        <div class="co-rate-b"><button type="button" data-share="${esc(r.token)}" data-pct="${r.percent}">Share your link</button></div>
        <p class="co-share-u" id="coShareU" hidden></p>
      </div>`;
    }
    confirmRoot.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-share]");
      if (!b) return;
      const url = shareUrl({ token: b.dataset.share });
      const text = `Lily's Mediterranean: here's ${b.dataset.pct}% off your first online order`;
      try {
        if (navigator.share) { await navigator.share({ title: "Lily's Mediterranean", text, url }); return; }
        await navigator.clipboard.writeText(url);
        const u = $("coShareU"); u.textContent = "Link copied. Paste it to a friend."; u.hidden = false;
      } catch {
        const u = $("coShareU"); u.textContent = url; u.hidden = false; // copy by hand
      }
    });
    // one-tap rating once the order is collected. The Google review link is
    // offered to EVERYONE who rates, good or bad: Google bans asking only the
    // happy customers.
    function rateHTML(o) {
      if (o.rated) return `<div class="co-rate"><p class="co-rate-t">Thanks for rating your order.</p>
        <a class="ink" href="${L.reviewsUrl}" target="_blank" rel="noopener">Leave a Google review</a></div>`;
      return `<div class="co-rate" id="coRate">
        <p class="co-rate-t">How was your food?</p>
        <div class="co-rate-b"><button type="button" data-rate="1">Great</button><button type="button" data-rate="-1">Not great</button></div>
      </div>`;
    }
    confirmRoot.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-rate],[data-rate-send]");
      if (!b) return;
      const box = document.getElementById("coRate");
      if (!box) return;
      if (b.dataset.rate) {
        box.dataset.rating = b.dataset.rate;
        box.innerHTML = `<p class="co-rate-t">${b.dataset.rate === "1" ? "Glad you enjoyed it!" : "Sorry about that."} Anything to tell the kitchen? <span class="muted">(optional)</span></p>
          <textarea id="coRateC" maxlength="500" rows="2"></textarea>
          <div class="co-rate-b"><button type="button" data-rate-send="1">Send</button></div>
          <a class="ink" href="${L.reviewsUrl}" target="_blank" rel="noopener">Leave a Google review</a>`;
        sendRating(box.dataset.rating, ""); // the tap counts even if they never type
        return;
      }
      await sendRating(box.dataset.rating, $("coRateC")?.value || "");
      box.innerHTML = `<p class="co-rate-t">Thank you, the kitchen will see that.</p>
        <a class="ink" href="${L.reviewsUrl}" target="_blank" rel="noopener">Leave a Google review</a>`;
    });
    async function sendRating(rating, comment) {
      try {
        await fetch(`${FN}/feedback`, { method: "POST", headers: HDRS, body: JSON.stringify({ sid, rating: Number(rating), comment }) });
      } catch { /* a lost rating is not worth an error message */ }
    }

    // Google Ads purchase conversion: dormant until Kareem's conversion label is
    // set in data.js (googleAdsConversion, e.g. "AW-18438934153/AbCdEf"). Fires
    // once per order, only for real paid orders, with the food value.
    function reportConversion(o) {
      const label = L.googleAdsConversion;
      if (!label || o.demo || o.status === "pending" || o.status === "canceled" || typeof gtag !== "function") return;
      const k = "lilys-conv-" + o.code;
      try { if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch { /* fine */ }
      gtag("event", "conversion", { send_to: label, value: (o.subtotal_cents - (o.discount_cents || 0)) / 100, currency: "USD", transaction_id: o.code });
    }

    let rendered = false;
    let failures = 0;
    const load = async () => {
      try {
        const r = await fetch(`${FN}/order-status?sid=${encodeURIComponent(sid)}`, { headers: HDRS });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "lookup failed");
        rendered = true;
        failures = 0;
        // never re-render over a rating the customer is in the middle of
        if (!document.getElementById("coRate")?.dataset.rating) render(j.order);
        reportConversion(j.order);
        if (!["done", "canceled"].includes(j.order.status)) {
          setTimeout(load, j.order.status === "pending" ? 5000 : 15000);
        }
      } catch {
        failures++;
        if (!rendered && failures >= 3) {
          // never saw the order at all — tell them, but keep trying
          confirmRoot.innerHTML = `<p class="confirm-error">We're having trouble loading your order — but if you paid, we have it!
            Call <a class="ink" href="tel:+13213124444">(321) 312-4444</a> if you need a hand.</p>`;
        }
        // a blip must never wipe the pickup code — keep what's shown, retry
        setTimeout(load, Math.min(30000, 5000 * failures));
      }
    };
    load();
    return;
  }

  /* ------------------------------------------------------- order page ---- */
  const tabs = $("orderTabs");
  const body = $("orderBody");
  if (!tabs || !body) return;

  if ($("prepMin")) $("prepMin").textContent = O.prepMinutes;
  if ($("cfClubText") && O.clubPercent) {
    $("cfClubText").textContent = `${O.clubPercent}% off your next order for joining, then members-only offers and a first look at new dishes, about once a month. Unsubscribe any time.`;
  }
  if ($("delMin")) $("delMin").textContent = O.deliveryMinutes;
  if (!O.deliveryEnabled) {
    // held until Kareem confirms drivers — shown, but not selectable
    const r = document.querySelector('input[name="ful"][value="delivery"]');
    if (r) r.disabled = true;
    if ($("fulDelivery")) $("fulDelivery").classList.add("off");
    if ($("fulDelNote")) $("fulDelNote").textContent = "Currently unavailable";
    if ($("heroDel")) $("heroDel").hidden = true;
  }

  // came back from Stripe without paying — cart is intact, say so
  if (new URLSearchParams(location.search).get("canceled") && $("closedNote")) {
    const note = $("closedNote");
    note.textContent = "Payment canceled — no worries, your cart is right where you left it.";
    note.hidden = false;
  }

  // closed note (server enforces too; demo orders are allowed while closed)
  const { day, hour } = L.nowInTz();
  const today = L.HOURS[day];
  const open = today && hour >= today[0] && hour < today[1];
  if (!open && $("closedNote")) $("closedNote").hidden = false;

  /* menu model: only fixed-price items are orderable online */
  const ITEMS = [];
  L.MENU.forEach((cat) =>
    cat.items.forEach(([name, desc, price, tag]) => {
      const cents = parsePrice(price);
      // `orderable` = can be bought online at all (has a fixed price).
      // `inStock`   = the kitchen hasn't 86'd it today. Fetched below; assume
      // in stock until told otherwise so a slow network never hides the menu.
      ITEMS.push({
        id: slug(name), name, desc, price, cents, tag, cat: cat.c, orderable: cents !== null, inStock: true,
        groups: L.addonGroupsFor ? L.addonGroupsFor(cat.c, name) : [],
      });
    })
  );
  const byId = new Map(ITEMS.map((it) => [it.id, it]));

  /* add-ons: same prices the server's addon_options table holds (sync-menu.mjs
     generates both from data.js); the server re-prices them anyway */
  const GROUPS = (L.ADDONS && L.ADDONS.groups) || {};
  const OPT = new Map();
  Object.entries(GROUPS).forEach(([g, grp]) =>
    grp.options.forEach(([oid, label, price]) => OPT.set(oid, { id: oid, group: g, name: label, cents: parsePrice(price), available: true, hidden: false })));
  // = stockState in create-checkout: out_until in the future means out of stock
  const isOut = (row) => { const t = row.out_until ? Date.parse(row.out_until) : NaN; return Number.isFinite(t) && t > Date.now(); };
  const lineKey = (id, opts) => (opts.length ? `${id}|${[...opts].sort().join(",")}` : id); // = create-checkout lineKey
  const optsCents = (opts) => opts.reduce((s, o) => s + (OPT.get(o)?.cents || 0), 0);
  const lineCents = (l) => byId.get(l.id).cents + optsCents(l.opts);
  const PHOTOS = window.LILYS_PHOTOS || {};

  /* ---- discount links (stickers on Uber Eats bags, refer-a-friend) -------
     The token arrives in the #fragment (#t= sticker, #r= referral), is checked
     with the server once, then kept with the cart. The server decides
     everything again at checkout; this only shows what's coming. */
  const CODE_KEY = "lilys-code-v1";
  let promoCode = null; // { token, kind, percent }
  try { promoCode = JSON.parse(localStorage.getItem(CODE_KEY) || "null"); } catch { /* none */ }
  const dropCode = () => { promoCode = null; try { localStorage.removeItem(CODE_KEY); } catch { /* fine */ } };
  async function readCodeFromLink() {
    const m = /^#([tr])=([23456789A-Za-z]{10})$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search); // keep it out of shared URLs
    try {
      const r = await fetch(`${FN}/create-checkout`, {
        method: "POST", headers: HDRS, body: JSON.stringify({ action: "code", promo_token: m[2].toUpperCase() }),
      });
      const j = await r.json();
      if (!r.ok) { showErr(j.error || "That discount link isn't valid."); return; }
      promoCode = { token: m[2].toUpperCase(), kind: j.kind, percent: j.percent };
      try { localStorage.setItem(CODE_KEY, JSON.stringify(promoCode)); } catch { /* still applies this visit */ }
      loadOffers();
      // say it up top too: on a phone the cart (and its offers box) is far below
      const note = document.createElement("div");
      note.className = "order-code-note";
      note.textContent = j.kind === "sticker"
        ? `Thanks for scanning! ${j.percent}% off your first online order, taken off at checkout.`
        : j.kind === "club"
        ? `Welcome to Lily's Club! Your ${j.percent}% off is applied at checkout.`
        : `A friend sent you ${j.percent}% off your first online order, taken off at checkout.`;
      $("closedNote")?.before(note);
    } catch { /* offline: no discount shown, nothing lost */ }
  }

  /* ------------------------------------------------------------- cart ---- */
  const CART_KEY = "lilys-cart-v1";
  // key (dish + its add-ons) -> { id, opts, qty }. The same dish with different
  // add-ons is a separate line, exactly as the server counts it.
  let cart = new Map();
  const validOpts = (it, opts) => Array.isArray(opts) &&
    opts.every((o) => OPT.has(o) && it.groups.includes(OPT.get(o).group));
  function loadCart() {
    const next = new Map();
    // saved as [id, qty, opts]; carts from before add-ons are [id, qty]
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    saved.forEach(([id, qty, opts = []]) => {
      const it = byId.get(id);
      if (!it?.orderable || !Number.isInteger(qty) || qty < 1 || !validOpts(it, opts)) return;
      next.set(lineKey(id, opts), { id, opts: [...opts], qty: Math.min(qty, 20) });
    });
    cart = next;
  }
  try { loadCart(); } catch { /* fresh cart */ }

  /* ---- live availability ------------------------------------------------
     The kitchen can mark an item out of stock; the server already refuses it
     at checkout. Without this the customer only finds out after filling a
     basket, so read the same switch here and grey it out up front.
     Failure is deliberately silent: if this call fails everything stays
     purchasable and the server is still the backstop. */
  async function loadAvailability() {
    try {
      const r = await fetch(`${L.ORDERING.supabaseUrl}/rest/v1/menu_items?select=id,orderable,out_until,hidden`, {
        headers: { apikey: L.ORDERING.anonKey, Authorization: `Bearer ${L.ORDERING.anonKey}` },
      });
      if (!r.ok) return;
      const rows = await r.json();
      if (!Array.isArray(rows)) return;
      let changed = false;
      rows.forEach((row) => {
        const it = byId.get(row.id);
        if (!it) return;
        const inStock = !!row.orderable && !isOut(row) && !row.hidden;
        if (it.inStock !== inStock || it.hidden !== !!row.hidden) { it.inStock = inStock; it.hidden = !!row.hidden; changed = true; }
      });
      try {
        const ra = await fetch(`${L.ORDERING.supabaseUrl}/rest/v1/addon_options?select=id,out_until,hidden`, {
          headers: { apikey: L.ORDERING.anonKey, Authorization: `Bearer ${L.ORDERING.anonKey}` },
        });
        const opts = ra.ok ? await ra.json() : [];
        if (Array.isArray(opts)) opts.forEach((row) => {
          const o = OPT.get(row.id);
          if (o) { o.hidden = !!row.hidden; o.available = !o.hidden && !isOut(row); }
        });
      } catch { /* add-ons stay pickable; the server refuses a sold-out one by name */ }
      // an out-of-stock item already in the basket has to go, and be seen to go
      let dropped = 0;
      [...cart].forEach(([key, l]) => {
        if (!byId.get(l.id).inStock || l.opts.some((o) => OPT.get(o)?.available === false)) { cart.delete(key); dropped++; }
      });
      if (dropped) {
        saveCart();
        showErr(`${dropped} item${dropped > 1 ? "s" : ""} in your basket sold out and ${dropped > 1 ? "have" : "has"} been removed.`);
      }
      if (!changed && !dropped) return;

      // patch the rows in place — the menu is built once inline, so there is
      // no whole-page re-render to call here
      ITEMS.forEach((it) => {
        const row = document.querySelector(`.order-item[data-item="${it.id}"]`);
        if (!row) return;
        row.style.display = it.hidden ? "none" : ""; // hidden in the kitchen = not on the menu at all
        row.classList.toggle("soldout", !it.inStock);
        const slot = row.querySelector(".oi-slot");
        if (!slot) return;
        if (!it.inStock) slot.innerHTML = `<span class="oi-soldout">Sold out</span>`;
        else if (it.orderable && !slot.querySelector(".oi-action")) {
          slot.innerHTML = `<span class="oi-action" data-id="${it.id}"></span>`;
        }
      });
      renderActions();
      renderCart();
    } catch { /* offline — server still refuses at checkout */ }
  }
  const saveCart = () => {
    try { localStorage.setItem(CART_KEY, JSON.stringify([...cart.values()].map((l) => [l.id, l.qty, l.opts]))); } catch { /* private mode */ }
  };

  const subtotal = () => [...cart.values()].reduce((s, l) => s + lineCents(l) * l.qty, 0);
  const count = () => [...cart.values()].reduce((s, l) => s + l.qty, 0);
  const qtyOf = (id) => [...cart.values()].reduce((s, l) => s + (l.id === id ? l.qty : 0), 0);

  /* ------------------------------------------------------ render menu ---- */
  const cats = [...new Set(ITEMS.map((it) => it.cat))];
  const catId = (c) => "oc-" + c.toLowerCase().replace(/[^a-z]+/g, "-");

  cats.forEach((c, i) => {
    const b = document.createElement("button");
    b.textContent = c;
    b.dataset.target = catId(c);
    if (i === 0) { b.classList.add("active"); b.setAttribute("aria-current", "true"); }
    tabs.appendChild(b);

    const sec = document.createElement("div");
    sec.className = "menu-cat";
    sec.id = catId(c);
    const rows = ITEMS.filter((it) => it.cat === c)
      .map((it) => {
        const ph = PHOTOS[it.name.toLowerCase()];
        const thumb = ph
          ? `<span class="mi-thumb photo"><img loading="lazy" decoding="async" width="58" height="58" src="assets/photos/thumbs/${ph.replace(/\.png$/, ".webp")}" alt=""></span>`
          : `<span class="mi-thumb none" aria-hidden="true"></span>`;
        const action = !it.inStock
          ? `<span class="oi-soldout">Sold out</span>`
          : it.orderable
          ? `<span class="oi-action" data-id="${it.id}"></span>`
          : `<a class="oi-call ink" href="tel:+13213124444">Call to order</a>`;
        return `<div class="menu-item order-item${ph ? " has-thumb" : ""}${it.inStock ? "" : " soldout"}${it.groups.length ? " has-addons" : ""}" data-item="${it.id}">
          ${thumb}
          <span class="mi-name">${esc(it.name)}${it.tag ? `<span class="tag">${it.tag}</span>` : ""}</span>
          <span class="mi-price">${it.orderable ? money(it.cents) : it.price}</span>
          <span class="mi-desc">${esc(it.desc)}</span>
          <span class="oi-slot">${action}</span>
        </div>`;
      })
      .join("");
    sec.innerHTML = `<h3>${c}</h3><div class="menu-list order-list">${rows}</div>`;
    body.appendChild(sec);
  });

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    tabs.querySelectorAll("button").forEach((x) => { x.classList.remove("active"); x.removeAttribute("aria-current"); });
    btn.classList.add("active");
    btn.setAttribute("aria-current", "true");
    tabs.scrollTo({ left: btn.offsetLeft - tabs.clientWidth / 2 + btn.offsetWidth / 2, behavior: "smooth" });
    document.getElementById(btn.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ------------------------------------------------- steppers + panel ---- */
  // a stepper works on a cart line (dish + add-ons); its key is the dish id
  // when there are no add-ons
  const stepper = (key, name) => {
    const qty = cart.get(key)?.qty || 0;
    return qty === 0
      ? `<button class="oi-add" data-add="${esc(key)}" aria-label="Add ${esc(name)} to cart">Add</button>`
      : `<span class="oi-step">
           <button data-dec="${esc(key)}" aria-label="One less ${esc(name)}">−</button>
           <b>${qty}</b>
           <button data-inc="${esc(key)}" aria-label="One more ${esc(name)}">+</button>
         </span>`;
  };

  // dishes with add-ons open the picker instead; the badge counts every
  // version of the dish in the cart
  const menuAction = (it) => {
    if (!it.groups.length) return stepper(it.id, it.name);
    const n = qtyOf(it.id);
    return `<button class="oi-add" data-custom="${it.id}" aria-label="Add ${esc(it.name)}, choose add-ons">Add${n ? ` <span class="oi-n">${n}</span>` : ""}</button>`;
  };

  const renderActions = () => {
    document.querySelectorAll(".oi-action").forEach((el) => { el.innerHTML = menuAction(byId.get(el.dataset.id)); });
  };

  const cartLines = $("cartLines"), cartEmpty = $("cartEmpty"), cartTotals = $("cartTotals"), cartForm = $("cartForm");
  const cartBar = $("cartBar");

  const renderCart = () => {
    const n = count();
    cartEmpty.hidden = n > 0;
    cartTotals.hidden = n === 0;
    cartForm.hidden = n === 0;
    cartLines.innerHTML = [...cart]
      .map(([key, l]) => {
        const it = byId.get(l.id);
        const adds = l.opts.map((o) => OPT.get(o)).filter(Boolean)
          .sort((a, b) => it.groups.indexOf(a.group) - it.groups.indexOf(b.group));
        return `<div class="cart-line">
          <span class="cl-qty">${stepper(key, it.name)}</span>
          <span class="cl-name">${esc(it.name)}${adds.length ? `<small class="cl-addons">+ ${adds.map((a) => esc(a.name)).join(", ")}</small>` : ""}</span>
          <span class="cl-price">${money(lineCents(l) * l.qty)}</span>
        </div>`;
      })
      .join("");
    if (n > 0) {
      const sub = subtotal();
      const tax = Math.round(sub * O.taxRate);
      // display only: the server recomputes every figure from its own rules
      const delivery = ful === "delivery";
      const fee = delivery && quote ? quote.fee_cents : 0;
      const tip = tipCents;
      $("ctSub").textContent = money(sub);
      $("ctTax").textContent = money(tax);
      $("ctDelRow").hidden = !delivery;
      $("ctDel").textContent = !delivery ? "" : quote ? (fee ? money(fee) : "Free") : "—";
      $("ctTipRow").hidden = !(tip > 0);
      $("ctTipL").textContent = delivery ? "Driver tip" : "Tip";
      $("ctTip").textContent = money(tip);
      $("ctTotal").textContent = money(sub + tax + fee + tip);
      $("cartBarCount").textContent = n === 1 ? "1 item" : `${n} items`;
      $("cartBarTotal").textContent = money(sub + tax + fee + tip);
      showMinimum();
    }
    if (cartBar) cartBar.hidden = n === 0;
    renderActions();
    saveCart();
  };

  let submitting = false;
  // add `qty` of a dish with these add-ons; false if the cart is full
  function addLine(id, opts, qty) {
    const key = lineKey(id, opts);
    const line = cart.get(key);
    if (!line && cart.size >= 40) {
      showErr("That's a lot of different dishes! Please call us for orders this size.");
      return false;
    }
    if (line) line.qty = Math.min(line.qty + qty, 20);
    else cart.set(key, { id, opts: [...opts], qty: Math.min(qty, 20) });
    window.LILYS_TRACK?.event("add_to_cart", id);
    return true;
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-custom]");
    if (c && !submitting) { openAddons(c.dataset.custom); return; }
    const t = e.target.closest("[data-add],[data-inc],[data-dec]");
    if (!t || submitting) return;
    const key = t.dataset.add || t.dataset.inc || t.dataset.dec;
    const line = cart.get(key);
    if (t.dataset.dec) {
      if (!line) return;
      if (line.qty <= 1) cart.delete(key);
      else line.qty -= 1;
    } else if (line) {
      line.qty = Math.min(line.qty + 1, 20);
      window.LILYS_TRACK?.event("add_to_cart", line.id);
    } else if (byId.get(key)) {
      if (!addLine(key, [], 1)) return;
    }
    renderCart();
  });

  /* ---- add-ons picker ---------------------------------------------------
     A native <dialog>: focus trap, Esc to close and a backdrop for free. */
  let sheet = null;
  function openAddons(id) {
    const it = byId.get(id);
    if (!it || !it.inStock) return;
    if (!sheet) {
      sheet = document.createElement("dialog");
      sheet.className = "ao-sheet";
      sheet.setAttribute("aria-labelledby", "aoTitle");
      document.body.appendChild(sheet);
      sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); }); // backdrop tap
    }
    let qty = 1;
    const groupsHTML = it.groups.map((g) => {
      const grp = GROUPS[g];
      if (!grp) return "";
      const opts = grp.options.map(([oid]) => OPT.get(oid)).filter((o) => o && o.cents !== null && !o.hidden);
      if (!opts.length) return "";
      return `<fieldset class="ao-group" data-g="${g}" data-max="${grp.max}">
        <legend>${esc(grp.label)}<span>${grp.max === 1 ? "Optional" : `Optional · up to ${grp.max}`}</span></legend>
        ${opts.map((o) => `<label class="ao-opt${o.available ? "" : " off"}">
          <input type="checkbox" value="${o.id}"${o.available ? "" : " disabled"}>
          <span class="ao-n">${esc(o.name)}</span>
          <span class="ao-p">${o.available ? `+${money(o.cents)}` : "Sold out"}</span>
        </label>`).join("")}
      </fieldset>`;
    }).join("");
    sheet.innerHTML = `<form method="dialog" class="ao-form">
      <div class="ao-head">
        <h2 id="aoTitle">${esc(it.name)}</h2>
        <button type="button" class="ao-x" aria-label="Close">×</button>
      </div>
      <div class="ao-body">
        ${it.desc ? `<p class="ao-desc">${esc(it.desc)}</p>` : ""}
        ${groupsHTML}
      </div>
      <div class="ao-foot">
        <span class="oi-step ao-qty">
          <button type="button" data-q="-1" aria-label="One less">−</button><b id="aoQty">1</b><button type="button" data-q="1" aria-label="One more">+</button>
        </span>
        <button type="submit" class="btn ao-add" id="aoAdd">Add</button>
      </div>
    </form>`;
    const picked = () => [...sheet.querySelectorAll("input:checked")].map((i) => i.value);
    const refresh = () => {
      // a full group greys out the rest of it, so the limit is visible, not an error
      sheet.querySelectorAll(".ao-group").forEach((fs) => {
        const n = fs.querySelectorAll("input:checked").length;
        const full = n >= Number(fs.dataset.max);
        fs.querySelectorAll("input:not(:checked)").forEach((i) => {
          i.disabled = full || OPT.get(i.value).available === false;
        });
      });
      $("aoQty").textContent = qty;
      $("aoAdd").textContent = `Add ${qty > 1 ? qty + " " : ""}· ${money((it.cents + optsCents(picked())) * qty)}`;
    };
    sheet.querySelector(".ao-x").addEventListener("click", () => sheet.close());
    sheet.querySelector(".ao-body").addEventListener("change", refresh);
    sheet.querySelector(".ao-qty").addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      qty = Math.max(1, Math.min(20, qty + Number(b.dataset.q)));
      refresh();
    });
    sheet.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (addLine(it.id, picked(), qty)) { sheet.close(); renderCart(); }
      else sheet.close();
    });
    refresh();
    sheet.showModal();
  }

  // mobile: the bar scrolls you to the cart panel
  $("cartBarBtn")?.addEventListener("click", () => {
    $("cartPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* --------------------------------------------------- pickup / delivery ---- */
  let ful = "pickup";
  let quote = null; // { address, miles, fee_cents } for the address as typed
  let tipCents = 0;
  const quoteEl = $("cfQuote");
  const addrEl = $("cfAddr");
  const DELIVERY_MIN = 1500; // mirrors create-checkout; the server enforces it

  const setQuoteMsg = (msg, bad = false) => {
    quoteEl.textContent = msg;
    quoteEl.classList.toggle("bad", bad);
  };
  function showMinimum() {
    if (ful !== "delivery") return;
    if (subtotal() < DELIVERY_MIN) setQuoteMsg("Delivery needs at least $15 of food.", true);
    else if (quote) setQuoteMsg(`${quote.miles.toFixed(1)} miles away · ${quote.fee_cents ? money(quote.fee_cents) + " delivery" : "free delivery"}`);
    else if (quoteEl.classList.contains("bad") && /at least \$15/.test(quoteEl.textContent)) setQuoteMsg("");
  }

  document.querySelectorAll('input[name="ful"]').forEach((r) =>
    r.addEventListener("change", () => {
      ful = r.value;
      $("cfDel").hidden = ful !== "delivery";
      $("cfTipL").textContent = ful === "delivery" ? "Tip for the driver" : "Add a tip for the team";
      $("cartFine").textContent = ful === "delivery"
        ? "Secure card payment by Stripe. We'll call this number if the driver can't find you."
        : "Secure card payment by Stripe. Show your order code at the counter.";
      renderCart();
    }));

  let quoteSeq = 0;
  async function checkAddress() {
    const address = addrEl.value.trim();
    quote = null;
    renderCart();
    if (address.length < 6) { setQuoteMsg(""); return; }
    const seq = ++quoteSeq;
    setQuoteMsg("Checking your address…");
    try {
      const r = await fetch(`${FN}/create-checkout`, {
        method: "POST", headers: HDRS, body: JSON.stringify({ action: "quote", address }),
      });
      const j = await r.json();
      if (seq !== quoteSeq) return; // a newer check is in flight
      if (!r.ok) { setQuoteMsg(j.error || "We couldn't check that address.", true); return; }
      quote = { address, miles: j.miles, fee_cents: j.fee_cents };
      setQuoteMsg("");
      renderCart();
    } catch {
      if (seq === quoteSeq) setQuoteMsg("We couldn't check that address just now. Please try again.", true);
    }
  }
  let addrTimer;
  addrEl.addEventListener("input", () => { clearTimeout(addrTimer); addrTimer = setTimeout(checkAddress, 900); });
  addrEl.addEventListener("change", () => { clearTimeout(addrTimer); checkAddress(); });

  $("tipRow").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tip]");
    if (!b) return;
    document.querySelectorAll("#tipRow button").forEach((x) => x.classList.toggle("on", x === b));
    const other = b.dataset.tip === "other";
    $("cfTipOther").hidden = !other;
    tipCents = other ? Math.round(Number($("cfTipOther").value || 0) * 100) : Number(b.dataset.tip);
    if (other) $("cfTipOther").focus();
    renderCart();
  });
  $("cfTipOther").addEventListener("input", () => {
    const d = Number($("cfTipOther").value);
    tipCents = Number.isFinite(d) && d > 0 ? Math.min(Math.round(d * 100), 10000) : 0;
    renderCart();
  });

  /* --------------------------------------------------------- checkout ---- */
  const errEl = $("cartError");
  cartForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const name = $("cfName").value.trim();
    const phone = $("cfPhone").value.trim();
    if (name.length < 2) return showErr("Please tell us your name for pickup.");
    if (phone.replace(/\D/g, "").length < 10) return showErr("Please enter a valid phone number.");
    if (count() === 0) return showErr("Your cart is empty.");
    if (ful === "delivery") {
      if (subtotal() < DELIVERY_MIN) return showErr("Delivery needs at least $15 of food. Add a little more, or choose pickup.");
      if (!quote || quote.address !== addrEl.value.trim()) {
        await checkAddress();
        if (!quote) return showErr("Please check your delivery address first.");
      }
    }

    window.LILYS_TRACK?.event("checkout_start");
    const btn = $("checkoutBtn");
    btn.disabled = true;
    btn.textContent = "Setting up payment…";
    submitting = true;
    try {
      const r = await fetch(`${FN}/create-checkout`, {
        method: "POST",
        headers: HDRS,
        body: JSON.stringify({
          items: [...cart.values()].map((l) => (l.opts.length ? { id: l.id, qty: l.qty, opts: l.opts } : { id: l.id, qty: l.qty })),
          name,
          phone,
          notes: $("cfNotes").value.trim(),
          fulfilment: ful,
          address: ful === "delivery" ? addrEl.value.trim() : "",
          tip_cents: tipCents,
          promo_token: promoCode?.token || "",
          offers_opt_in: $("cfClub")?.checked === true,
          source: window.LILYS_TRACK?.source() || "direct",
          source_detail: window.LILYS_TRACK?.detail() || "",
        }),
      });
      const j = await r.json();
      // a discount link that doesn't apply (used, not a first order...) must not
      // block the order: drop it and let them pay without it
      if (!r.ok && promoCode && /discount|sticker|share link|referral/i.test(j.error || "")) {
        dropCode();
        loadOffers();
        throw new Error(`${j.error} We've removed it, so you can place the order without it.`);
      }
      if (!r.ok) throw new Error(j.error || "Something went wrong.");
      // the cart survives until the order is truly done — if they cancel on
      // the Stripe page and come back, nothing is lost. The confirmation
      // page clears it. (Demo orders are complete immediately, same path.)
      location.href = j.url;
    } catch (ex) {
      submitting = false;
      showErr(ex.message || "Something went wrong — please try again or call us.");
      btn.disabled = false;
      btn.innerHTML = 'Pay &amp; place order <span class="arw">→</span>';
    }
  });

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  // back/forward cache restore (e.g. back-button from Stripe): the DOM
  // snapshot may show a dead button and a cart that changed elsewhere
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    submitting = false;
    const btn = $("checkoutBtn");
    btn.disabled = false;
    btn.innerHTML = 'Pay &amp; place order <span class="arw">→</span>';
    try { loadCart(); } catch { /* keep in-memory cart */ }
    renderCart();
  });

  renderCart();

  // last, so every render helper it calls is already initialised. Also re-run
  // on wake: a phone left open overnight would otherwise show yesterday's stock.
  /* ---- offers ------------------------------------------------------------
     Shows WHAT is on, never the arithmetic. The discount itself is computed
     once, on the server, from the same prices the order is built from — so
     there is no second copy of the money logic here to drift out of step with
     it. The customer sees the real figure on the payment page. */
  async function loadOffers() {
    const box = document.getElementById("offers");
    if (!box) return;
    let rows = [];
    try {
      const r = await fetch(
        `${L.ORDERING.supabaseUrl}/rest/v1/promotions?select=label,days,start_min,end_min,starts_at,ends_at&active=eq.true`,
        { headers: { apikey: L.ORDERING.anonKey, Authorization: `Bearer ${L.ORDERING.anonKey}` } });
      const j = r.ok ? await r.json() : [];
      // only what's running right now, on the Florida clock (= create-checkout promoRunsAt)
      const { day, hour } = L.nowInTz();
      const minute = Math.floor(hour * 60), now = Date.now();
      if (Array.isArray(j)) rows = j.filter((p) =>
        !(p.starts_at && Date.parse(p.starts_at) > now) && !(p.ends_at && Date.parse(p.ends_at) < now) &&
        !((p.days || []).length && !p.days.includes(day)) &&
        (p.start_min == null || p.end_min == null || (minute >= p.start_min && minute < p.end_min)));
    } catch { /* no offers shown; nothing is lost */ }
    const code = promoCode
      ? `<div class="offer">${promoCode.kind === "sticker"
          ? `${promoCode.percent}% off your first online order (bag sticker)`
          : promoCode.kind === "club"
          ? `Lily's Club: ${promoCode.percent}% off this order`
          : `${promoCode.percent}% off from a friend's link`}
          <button type="button" class="offer-x" id="codeX">Remove</button></div>`
      : "";
    if (!rows.length && !code) { box.hidden = true; return; }
    box.innerHTML = `<div class="offers-t">On right now</div>` +
      rows.map((o) => `<div class="offer">${esc(o.label)}</div>`).join("") + code +
      `<div class="offers-n">Taken off automatically at checkout.</div>`;
    box.hidden = false;
    $("codeX")?.addEventListener("click", () => { dropCode(); loadOffers(); });
  }

  loadOffers();
  readCodeFromLink();
  loadAvailability();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadAvailability();
  });
})();
