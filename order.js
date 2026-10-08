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
        .map((l) => `<div class="co-line"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.unit_cents * l.qty)}</span></div>`)
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
             <a class="ink" href="${L.directionsUrl}" target="_blank" rel="noopener">Directions</a> · <a class="ink" href="${L.phoneHref}">${L.phone}</a></p>`}
        <div class="co-receipt">
          ${items}
          <div class="co-line co-sub"><span>Subtotal</span><span>${money(o.subtotal_cents)}</span></div>
          ${o.discount_cents > 0 ? `<div class="co-line co-sub"><span>Offers</span><span>−${money(o.discount_cents)}</span></div>` : ""}
          <div class="co-line co-sub"><span>Tax</span><span>${money(o.tax_cents)}</span></div>
          ${o.delivery_fee_cents > 0 ? `<div class="co-line co-sub"><span>Delivery</span><span>${money(o.delivery_fee_cents)}</span></div>` : ""}
          ${o.tip_cents > 0 ? `<div class="co-line co-sub"><span>Driver tip</span><span>${money(o.tip_cents)}</span></div>` : ""}
          <div class="co-line co-total"><span>${totalLabel}</span><span>${money(o.total_cents)}</span></div>
        </div>`;
    };
    let rendered = false;
    let failures = 0;
    const load = async () => {
      try {
        const r = await fetch(`${FN}/order-status?sid=${encodeURIComponent(sid)}`, { headers: HDRS });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "lookup failed");
        rendered = true;
        failures = 0;
        render(j.order);
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
      ITEMS.push({ id: slug(name), name, desc, price, cents, tag, cat: cat.c, orderable: cents !== null, inStock: true });
    })
  );
  const byId = new Map(ITEMS.map((it) => [it.id, it]));
  const PHOTOS = window.LILYS_PHOTOS || {};

  /* ------------------------------------------------------------- cart ---- */
  const CART_KEY = "lilys-cart-v1";
  let cart = new Map(); // id -> qty
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    saved.forEach(([id, qty]) => {
      if (byId.get(id)?.orderable && Number.isInteger(qty) && qty > 0) cart.set(id, Math.min(qty, 20));
    });
  } catch { /* fresh cart */ }

  /* ---- live availability ------------------------------------------------
     The kitchen can mark an item out of stock; the server already refuses it
     at checkout. Without this the customer only finds out after filling a
     basket, so read the same switch here and grey it out up front.
     Failure is deliberately silent: if this call fails everything stays
     purchasable and the server is still the backstop. */
  async function loadAvailability() {
    try {
      const r = await fetch(`${L.ORDERING.supabaseUrl}/rest/v1/menu_items?select=id,orderable`, {
        headers: { apikey: L.ORDERING.anonKey, Authorization: `Bearer ${L.ORDERING.anonKey}` },
      });
      if (!r.ok) return;
      const rows = await r.json();
      if (!Array.isArray(rows)) return;
      let changed = false;
      rows.forEach((row) => {
        const it = byId.get(row.id);
        if (it && it.inStock !== row.orderable) { it.inStock = !!row.orderable; changed = true; }
      });
      // an out-of-stock item already in the basket has to go, and be seen to go
      let dropped = 0;
      [...cart.keys()].forEach((id) => {
        if (byId.get(id) && !byId.get(id).inStock) { cart.delete(id); dropped++; }
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
        row.classList.toggle("soldout", !it.inStock);
        const slot = row.querySelector(".oi-slot");
        if (!slot) return;
        if (!it.inStock) slot.innerHTML = `<span class="oi-soldout">Sold out today</span>`;
        else if (it.orderable && !slot.querySelector(".oi-action")) {
          slot.innerHTML = `<span class="oi-action" data-id="${it.id}"></span>`;
        }
      });
      renderActions();
      renderCart();
    } catch { /* offline — server still refuses at checkout */ }
  }
  const saveCart = () => localStorage.setItem(CART_KEY, JSON.stringify([...cart]));

  const subtotal = () => [...cart].reduce((s, [id, qty]) => s + byId.get(id).cents * qty, 0);
  const count = () => [...cart.values()].reduce((s, q) => s + q, 0);

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
          ? `<span class="oi-soldout">Sold out today</span>`
          : it.orderable
          ? `<span class="oi-action" data-id="${it.id}"></span>`
          : `<a class="oi-call ink" href="tel:+13213124444">Call to order</a>`;
        return `<div class="menu-item order-item${ph ? " has-thumb" : ""}${it.inStock ? "" : " soldout"}" data-item="${it.id}">
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
  const stepper = (id) => {
    const qty = cart.get(id) || 0;
    return qty === 0
      ? `<button class="oi-add" data-add="${id}" aria-label="Add ${esc(byId.get(id).name)} to cart">Add</button>`
      : `<span class="oi-step">
           <button data-dec="${id}" aria-label="One less ${esc(byId.get(id).name)}">−</button>
           <b>${qty}</b>
           <button data-inc="${id}" aria-label="One more ${esc(byId.get(id).name)}">+</button>
         </span>`;
  };

  const renderActions = () => {
    document.querySelectorAll(".oi-action").forEach((el) => { el.innerHTML = stepper(el.dataset.id); });
  };

  const cartLines = $("cartLines"), cartEmpty = $("cartEmpty"), cartTotals = $("cartTotals"), cartForm = $("cartForm");
  const cartBar = $("cartBar");

  const renderCart = () => {
    const n = count();
    cartEmpty.hidden = n > 0;
    cartTotals.hidden = n === 0;
    cartForm.hidden = n === 0;
    cartLines.innerHTML = [...cart]
      .map(([id, qty]) => {
        const it = byId.get(id);
        return `<div class="cart-line">
          <span class="cl-qty">${stepper(id)}</span>
          <span class="cl-name">${esc(it.name)}</span>
          <span class="cl-price">${money(it.cents * qty)}</span>
        </div>`;
      })
      .join("");
    if (n > 0) {
      const sub = subtotal();
      const tax = Math.round(sub * O.taxRate);
      // display only: the server recomputes every figure from its own rules
      const delivery = ful === "delivery";
      const fee = delivery && quote ? quote.fee_cents : 0;
      const tip = delivery ? tipCents : 0;
      $("ctSub").textContent = money(sub);
      $("ctTax").textContent = money(tax);
      $("ctDelRow").hidden = !delivery;
      $("ctDel").textContent = !delivery ? "" : quote ? (fee ? money(fee) : "Free") : "—";
      $("ctTipRow").hidden = !(delivery && tip > 0);
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
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-add],[data-inc],[data-dec]");
    if (!t || submitting) return;
    const id = t.dataset.add || t.dataset.inc || t.dataset.dec;
    const qty = cart.get(id) || 0;
    if (t.dataset.dec) {
      if (qty <= 1) cart.delete(id);
      else cart.set(id, qty - 1);
    } else {
      if (qty === 0 && cart.size >= 40) {
        showErr("That's a lot of different dishes! Please call us for orders this size.");
        return;
      }
      cart.set(id, Math.min(qty + 1, 20));
    }
    renderCart();
  });

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

    const btn = $("checkoutBtn");
    btn.disabled = true;
    btn.textContent = "Setting up payment…";
    submitting = true;
    try {
      const r = await fetch(`${FN}/create-checkout`, {
        method: "POST",
        headers: HDRS,
        body: JSON.stringify({
          items: [...cart].map(([id, qty]) => ({ id, qty })),
          name,
          phone,
          notes: $("cfNotes").value.trim(),
          fulfilment: ful,
          address: ful === "delivery" ? addrEl.value.trim() : "",
          tip_cents: ful === "delivery" ? tipCents : 0,
        }),
      });
      const j = await r.json();
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
    try {
      cart = new Map();
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      saved.forEach(([id, qty]) => {
        if (byId.get(id)?.orderable && Number.isInteger(qty) && qty > 0) cart.set(id, Math.min(qty, 20));
      });
    } catch { /* keep in-memory cart */ }
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
    try {
      const r = await fetch(
        `${L.ORDERING.supabaseUrl}/rest/v1/promotions?select=label&active=eq.true`,
        { headers: { apikey: L.ORDERING.anonKey, Authorization: `Bearer ${L.ORDERING.anonKey}` } });
      if (!r.ok) return;
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return;
      box.innerHTML = `<div class="offers-t">On right now</div>` +
        rows.map((o) => `<div class="offer">${esc(o.label)}</div>`).join("") +
        `<div class="offers-n">Taken off automatically at checkout.</div>`;
      box.hidden = false;
    } catch { /* no offers shown; nothing is lost */ }
  }

  loadOffers();
  loadAvailability();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadAvailability();
  });
})();
