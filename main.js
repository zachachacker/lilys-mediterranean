/* Lily's Mediterranean — interactions. Progressive: page works without JS. */
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- menu data lives in data.js (window.LILYS) — one source of truth
     for the pages AND the Ask Lily's chatbot. Fallback kept for safety. ---- */
  /* ---- menu data lives in data.js (window.LILYS) — ONE source of truth for
     the pages, the ordering system and the Ask Lily's chatbot.
     There used to be a full hard-coded copy of the menu here as a "safety"
     fallback. It silently went stale: by 2026-07-25 it still quoted $8.99
     hummus and listed dishes that had been taken off. A fallback that lies
     about prices is worse than no menu, so if data.js fails to load we say so
     and send people to the phone instead. ---- */
  const MENU = (window.LILYS && window.LILYS.MENU) || [];

  const leaf = '<svg class="leaf" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 21c6-2 9-7 9-14-6 1-11 4-11 10"/><path d="M12 21c0-5-2-8-6-9"/></svg>';

  /* dish-name -> harvested photo (assets/photos/). Aliases cover menu
     variants that share one photo on the ordering system. */
  const PHOTOS = {
    "hummus": "hummus.png", "lily's ultimate hummus": "lily-s-ultimate-hummus.png",
    "baba ghanouj": "baba-ghanouj.png", "batata harrah": "batata-harrah.png",
    "cheese spring roll": "homemade-cheese-spring-roll.png", "falafel": "falafel-humus-and-cucumber.png",
    "grape leaves": "grape-leaves.png",
    "kibbeh": "kibbeh.png", "ultimate cold mezza": "ultimate-cold-mezza.png",
    "greek salad": "greek-salad.png", "fattoush salad": "fattoush-salad.png",
    "tabbouleh": "tabbouleh.png", "caesar salad": "caesar-salad.png",
    "chicken caesar salad": "caesar-salad.png", "shrimp caesar salad": "caesar-salad.png",
    "homemade lentil soup": "homemade-lentil-soup.png", "homemade pumpkin soup": "homemade-pumpkin-soup.png",
    "lamb & beef gyro wrap": "lamb-beef-gyro-wrap.png", "chicken gyro wrap": "chicken-gyro-wrap.png",
    "chicken shawarma wrap": "chicken-shawarma-wrap.png", "beef shawarma wrap": "beef-shawarma-wrap.png",
    "shish tawouk wrap": "shish-tawouk-wrap.png", "falafel wrap": "falafel-humus-and-cucumber.png",
    "hummus & tabbouleh wrap": "hummus-tabbouleh-wrap.png",
    "lily's mixed grill platter": "lily-s-mixed-grill-platter.png", "mixed grill platter": "mixed-grill-platter.png",
    "bone-in lamb chops platter": "bone-in-lamb-chops-platter.png", "beef kabob platter": "beef-kafta-platter.png",
    "beef kafta platter": "beef-kafta-platter.png", "best friend platter": "best-friend-platter.png",
    "chicken shawarma platter": "chicken-shawarma-platter.png", "lamb & beef platter": "lamb-beef-gyro-platter.png",
    "jumbo shrimp platter": "grilled-shrimp-platter.png",
    "grilled chicken bowl": "grilled-chicken-bowl.png", "falafel bowl": "falafel-bowl.png",
    "family mixed grill": "family-mixed-grill.png", "family mixed gyro": "family-mixed-gyro.png",
    "family mixed shawarma": "family-mixed-shawarma.png", "family falafel platter": "family-falafel-platter.png",
    "cheeseburger": "cheeseburger.png", "angus beef burger": "cheeseburger.png", "kid cheeseburger": "kid-cheeseburger.png",
    "chicken quesadilla": "chicken-quesadilla.png",
    "steak quesadilla": "steak-quesadilla.png",
    "fries basket": "seasoned-fries-basket.png", "seasoned fries basket": "seasoned-fries-basket.png", "sweet potato fries": "sweet-potato-french-fries.png",
    "garlic rice": "garlic-rice.png",
    "homemade baklava": "baklava.png", "ny cheesecake": "ny-cheesecake.png", "tiramisu": "tiramisu.png",
    // current menu names that the aliases above missed (2026-10-10)
    "homemade kibbeh": "kibbeh.png", "angus cheeseburger": "cheeseburger.png", "new york cheesecake": "ny-cheesecake.png",
    "lamb & beef gyro platter": "lamb-beef-gyro-platter.png", "tawouk platter": "tawouk-platter-chicken-kabob.png",
    "kid burger": "kid-cheeseburger.png",
  };
  window.LILYS_PHOTOS = PHOTOS; // order.js reuses the same thumbs

  /* ---- render menu ---- */
  const tabs = document.getElementById("menuTabs");
  const body = document.getElementById("menuBody");
  if (tabs && body && !MENU.length) {
    // data.js didn't load. Say so plainly — never render a half-menu.
    const tel = (window.LILYS && window.LILYS.phone) || "(321) 312-4444";
    const href = (window.LILYS && window.LILYS.phoneHref) || "tel:+13213124444";
    body.innerHTML = `<p class="menu-fallback">Our menu isn't loading right now. ` +
      `Please call us on <a href="${href}">${tel}</a> and we'll take your order over the phone.</p>`;
  } else if (tabs && body) {
    const hashId = location.hash.slice(1);
    const setActive = (btn) => {
      tabs.querySelectorAll("button").forEach((x) => { x.classList.remove("active"); x.removeAttribute("aria-current"); });
      btn.classList.add("active");
      btn.setAttribute("aria-current", "true");
      // keep the active pill visible in the horizontally-scrolling sticky bar
      tabs.scrollTo({ left: btn.offsetLeft - tabs.clientWidth / 2 + btn.offsetWidth / 2, behavior: reduce ? "auto" : "smooth" });
    };
    MENU.forEach((cat, i) => {
      const id = "cat-" + cat.c.toLowerCase().replace(/[^a-z]+/g, "-");
      const b = document.createElement("button");
      b.textContent = cat.c;
      b.dataset.target = id;
      if (hashId ? id === hashId : i === 0) { b.classList.add("active"); b.setAttribute("aria-current", "true"); }
      tabs.appendChild(b);

      const sec = document.createElement("div");
      sec.className = "menu-cat"; // deliberately not .reveal — the menu must never depend on an observer to be visible
      sec.id = id;
      let rows = "";
      cat.items.forEach(([n, d, p, tag]) => {
        const ph = PHOTOS[n.toLowerCase()];
        const thumb = ph
          ? `<span class="mi-thumb photo"><img loading="lazy" decoding="async" width="58" height="58" src="assets/photos/thumbs/${ph.replace(/\.png$/, ".webp")}" alt=""></span>`
          : `<span class="mi-thumb none" aria-hidden="true"></span>`;
        const sid = n.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); // = sync-menu slug
        rows += `<div class="menu-item${ph ? " has-thumb" : ""}" data-item="${sid}">${thumb}<span class="mi-name">${n}${tag ? `<span class="tag">${tag}</span>` : ""}</span><span class="mi-price">${window.LILYS ? window.LILYS.onlinePrice(p) : p}</span><span class="mi-desc">${d}</span></div>`;
      });
      sec.innerHTML = `<h3>${leaf}${cat.c}</h3><div class="menu-list">${rows}</div>`;
      body.appendChild(sec);
    });
    // the kitchen's stock switches: hidden dishes leave the menu, sold-out ones
    // say so. Silent on failure; the printed menu is still right.
    const O = window.LILYS && window.LILYS.ORDERING;
    if (O) {
      fetch(`${O.supabaseUrl}/rest/v1/menu_items?select=id,out_until,hidden`, {
        headers: { apikey: O.anonKey, Authorization: `Bearer ${O.anonKey}` },
      }).then((r) => (r.ok ? r.json() : [])).then((rows) => {
        if (!Array.isArray(rows)) return;
        rows.forEach((row) => {
          const el = body.querySelector(`.menu-item[data-item="${row.id}"]`);
          if (!el) return;
          const t = row.out_until ? Date.parse(row.out_until) : NaN;
          el.style.display = row.hidden ? "none" : "";
          el.classList.toggle("soldout", Number.isFinite(t) && t > Date.now());
        });
      }).catch(() => {});
    }
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      setActive(btn);
      const el = document.getElementById(btn.dataset.target);
      if (el) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
    // scrollspy: the active pill follows the reader through the categories
    if ("IntersectionObserver" in window) {
      const spy = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const btn = tabs.querySelector(`button[data-target="${en.target.id}"]`);
          if (btn && !btn.classList.contains("active")) setActive(btn);
        });
      }, { rootMargin: "-30% 0px -60% 0px", threshold: 0 });
      body.querySelectorAll(".menu-cat").forEach((el) => spy.observe(el));
    }
  }

  /* ---- sticky nav condense (menu page keeps a solid nav always) ---- */
  const nav = document.getElementById("nav");
  if (!document.body.classList.contains("menu-page")) {
    const onScroll = () => { nav.classList.toggle("solid", window.scrollY > window.innerHeight * 0.72); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- mobile menu ---- */
  const toggle = document.getElementById("navToggle");
  const mm = document.getElementById("mobileMenu");
  if (toggle && mm) {
    const set = (open) => {
      nav.classList.toggle("open", open);
      mm.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      mm.toggleAttribute("inert", !open);
      document.body.classList.toggle("nav-open", open);
      document.body.style.overflow = open ? "hidden" : "";
    };
    toggle.addEventListener("click", () => set(!mm.classList.contains("open")));
    mm.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => set(false)));
  }

  /* ---- reveal on scroll ---- */
  if (!reduce && "IntersectionObserver" in window) {
    let ioRevealed = false; // true once the observer has actually revealed something
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { ioRevealed = true; en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    // safety net: content must never stay hidden. If an element sits well inside
    // the viewport and the observer has never revealed anything, it's broken —
    // show everything and stop trusting it. Debounced so a healthy observer
    // always gets to act first.
    let rescueTimer = 0;
    const rescueCheck = () => {
      if (ioRevealed) { window.removeEventListener("scroll", scheduleRescue); return; }
      const stuck = [...document.querySelectorAll(".reveal:not(.in)")].some((el) => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight * 0.75 && r.bottom > window.innerHeight * 0.25;
      });
      if (stuck) {
        io.disconnect();
        window.removeEventListener("scroll", scheduleRescue);
        document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
      }
    };
    const scheduleRescue = () => {
      if (ioRevealed) { window.removeEventListener("scroll", scheduleRescue); return; }
      clearTimeout(rescueTimer);
      rescueTimer = setTimeout(rescueCheck, 400);
    };
    setTimeout(rescueCheck, 2500);
    window.addEventListener("scroll", scheduleRescue, { passive: true });
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }

  /* ---- magnetic order button ---- */
  const mag = document.getElementById("magnet");
  if (mag && !reduce && window.matchMedia("(pointer:fine)").matches) {
    let raf = 0;
    // near-instant transform while tracking; the CSS var(--dur-fast) ease springs it home on leave
    mag.addEventListener("pointerenter", () => {
      mag.style.transition = "transform 0.1s linear, box-shadow 0.35s var(--ease-2)";
      mag.style.willChange = "transform";
    });
    mag.addEventListener("pointermove", (e) => {
      const r = mag.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.25;
      const y = (e.clientY - r.top - r.height / 2) * 0.35;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { mag.style.transform = `translate(${Math.max(-10, Math.min(10, x))}px, ${Math.max(-8, Math.min(8, y))}px)`; });
    });
    mag.addEventListener("pointerleave", () => {
      cancelAnimationFrame(raf);
      mag.style.transform = "";
      mag.style.transition = "";
      mag.style.willChange = "";
    });
  }

  /* ---- live open/closed pill + today highlight ----
     Hours confirmed by Kareem (2026-07-11): Wed closed, Fri/Sat till 11pm. */
  const HOURS = (window.LILYS && window.LILYS.HOURS) ||
    { 0: [11, 22], 1: [11, 22], 2: [11, 22], 3: null, 4: [11, 22], 5: [11, 23], 6: [11, 23] };
  // The restaurant runs on Florida time regardless of where the visitor is.
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = now.getDay();
  const hour = now.getHours() + now.getMinutes() / 60;
  const today = HOURS[day];
  const open = today && hour >= today[0] && hour < today[1];
  const fmt = (h) => (h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`);
  const mount = document.getElementById("statusMount");
  if (mount) {
    let label;
    if (open) {
      label = `Open now · until ${fmt(today[1])}`;
    } else if (today && hour < today[0]) {
      label = `Opens ${fmt(today[0])} today`;
    } else {
      // find next open day
      let n = 1; while (n <= 7 && !HOURS[(day + n) % 7]) n++;
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const next = HOURS[(day + n) % 7];
      label = `Closed · opens ${names[(day + n) % 7]} ${fmt(next[0])}`;
    }
    mount.outerHTML = `<span class="pill ${open ? "open" : "shut"}"><i class="live"></i>${label}</span>`;
  }
  const row = document.querySelector(`#hoursTable tr[data-day="${day}"]`);
  if (row) {
    row.classList.add("today");
    const dayCell = row.querySelector("th");
    if (dayCell) dayCell.insertAdjacentHTML("beforeend", '<span class="sr-only"> (today)</span>');
  }

  /* Homepage signature rail — photos and copy are hand-written, but the PRICE
     and the menu link are pulled from data.js. These were hand-typed once and
     had all drifted (every price stale, four of six anchors pointing at
     categories that no longer exist). Deriving them means a menu edit can
     never leave this section lying about the price again. */
  (function syncSignatureRail() {
    const L = window.LILYS;
    if (!L) return;
    const slug = (c) => "cat-" + c.toLowerCase().replace(/[^a-z]+/g, "-");
    document.querySelectorAll("[data-dish]").forEach((card) => {
      const want = card.dataset.dish;
      let found = null;
      for (const cat of L.MENU) {
        const it = cat.items.find(([n]) => n === want);
        if (it) { found = { cat, it }; break; }
      }
      if (!found) { // renamed or retired — say nothing rather than something wrong
        const p = card.querySelector(".price");
        if (p) p.remove();
        return;
      }
      const priceEl = card.querySelector(".price");
      if (priceEl) priceEl.textContent = L.onlinePrice(found.it[2]);
      // the hero tag is a <figure> with no link — only anchors get the href
      if (card.tagName === "A") card.setAttribute("href", "menu.html#" + slug(found.cat.c));
    });
  })();
})();
