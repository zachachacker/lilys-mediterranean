/* Lily's Mediterranean — interactions. Progressive: page works without JS. */
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- menu data lives in data.js (window.LILYS) — one source of truth
     for the pages AND the Ask Lily's chatbot. Fallback kept for safety. ---- */
  const MENU = (window.LILYS && window.LILYS.MENU) || [
    { c: "Appetizers", items: [
      ["Hummus", "Chickpeas, tahini, garlic, lemon & olive oil, with pita.", "$8.99", "Vegan"],
      ["Lily's Ultimate Hummus", "Hummus topped with olive oil, chickpeas, feta, olives, tomato, herbs & paprika.", "$12.49", ""],
      ["Baba Ghanouj", "Baked eggplant blended with tahini, lemon, olive oil & garlic.", "$8.99", "Veg"],
      ["Batata Harrah", "Potato cubes sautéed with garlic, cilantro, lemon & chili flakes.", "$9.49", "Vegan"],
      ["Cheese Spring Roll", "Mozzarella & feta with dried mint in crispy phyllo. (4 pc)", "$8.49", "Veg"],
      ["Falafel", "Ground fava & chickpeas, deep fried. (4 pc)", "$7.49", "Vegan"],
      ["Grape Leaves", "Rolled vegetarian grape leaves, hummus & pickles. (5 pc)", "$7.49", "Vegan"],
      ["Homemade Spinach Pie", "Spinach & onion baked in homemade pastry, hummus & pickles.", "$8.49", "Veg"],
      ["Kibbeh", "Lean beef & cracked wheat filled with beef, onion & nuts. (3 pc)", "$15.99", ""],
      ["Ultimate Cold Mezza", "Tabbouleh, hummus, baba ghanouj, falafel & grape leaves with pita.", "$24.49", "Vegan"],
    ]},
    { c: "Salad & Soup", items: [
      ["Greek Salad", "Lettuce, tomato, cucumber, pepper, onion, olives, feta, pepperoncini.", "$11.49", "Veg"],
      ["Fattoush Salad", "Garden salad with toasted pita, sumac & vinaigrette.", "$11.99", "Vegan"],
      ["Tabbouleh", "Parsley, mint & tomato with bulgur, lime & olive oil.", "$14.49", "Veg"],
      ["Caesar Salad", "Romaine, croutons, parmesan & Caesar dressing.", "$10.49", ""],
      ["Chicken Caesar Salad", "Classic Caesar with grilled chicken.", "$14.49", ""],
      ["Shrimp Caesar Salad", "Classic Caesar with grilled shrimp.", "$16.49", ""],
      ["Homemade Lentil Soup", "Lentil soup with traditional Mediterranean spices.", "$8.49", ""],
      ["Homemade Pumpkin Soup", "House-made pumpkin soup.", "$9.49", "Vegan"],
    ]},
    { c: "Gyros Wraps", items: [
      ["Lamb & Beef Gyro Wrap", "Spiced lamb/beef, grilled onion & pepper, tomato, lettuce, feta & tzatziki.", "$12.99", ""],
      ["Chicken Gyro Wrap", "Grilled chicken breast, grilled onion & pepper, feta & tzatziki.", "$12.49", ""],
    ]},
    { c: "Pita Wraps", items: [
      ["Chicken Shawarma Wrap", "Roasted marinated chicken, pickles & house garlic sauce.", "$11.99", ""],
      ["Beef Shawarma Wrap", "Roasted marinated beef, tomato, parsley, onion, pickles & tahini.", "$14.49", ""],
      ["Shish Tawouk Wrap", "Char-grilled chicken cubes, pickles & garlic sauce.", "$13.49", ""],
      ["Falafel Wrap", "Falafel, lettuce, tomato, pickles & tahini.", "$11.49", "Vegan"],
      ["Eggplant & Cauliflower Wrap", "Fried eggplant & cauliflower, hummus, turnip, lettuce, tahini.", "$10.49", "Vegan"],
      ["Garlic Rice Chicken Wrap", "Garlic rice, chicken, mayo, onion, pepper & mozzarella.", "$15.49", ""],
      ["Hummus & Tabbouleh Wrap", "House hummus & tabbouleh in a pita.", "$11.49", "Vegan"],
    ]},
    { c: "Lily's Platters", items: [
      ["Lily's Mixed Grill Platter", "Beef tenderloin, chicken tawouk, kafta & jumbo shrimp, salad, hummus, garlic sauce.", "$25.49", "GF"],
      ["Mixed Grill Platter", "Beef tenderloin, chicken tawouk & kafta, salad, hummus, garlic sauce.", "$22.49", "GF"],
      ["Bone-In Lamb Chops Platter", "Three marinated lamb chops, garlic rice & hummus.", "$26.49", "GF"],
      ["Beef Kabob Platter", "Two tenderloin skewers, house salad & hummus.", "$21.49", "GF"],
      ["Beef Kafta Platter", "Two charbroiled ground-beef skewers with parsley & onion, salad, hummus.", "$18.00", "GF"],
      ["Best Friend Platter", "Chicken tawouk, tabbouleh, hummus, garlic sauce, grape leaves & rice.", "$22.49", "GF"],
      ["Chicken Shawarma Platter", "Sliced chicken, house salad, pickles & garlic sauce.", "$18.49", "GF"],
      ["Beef Shawarma Platter", "Sliced beef with tahini, house salad & hummus.", "$20.49", "GF"],
      ["Lamb & Beef Platter", "Seasoned lamb & beef, salad with feta, tomato, onion, pepper & tzatziki.", "$19.49", ""],
      ["Jumbo Shrimp Platter", "Two skewers grilled jumbo shrimp, salad & garlic sauce.", "$24.49", ""],
    ]},
    { c: "Lily's Bowls", items: [
      ["Grilled Chicken Bowl", "Grilled chicken, rice, hummus, side salad & garlic sauce.", "$16.49", "GF"],
      ["Falafel Bowl", "Falafel, rice, hummus, salad, pickles & tahini.", "$14.49", "GF"],
      ["Eggplant & Cauliflower Bowl", "Fried eggplant & cauliflower over rice with hummus & tahini.", "$14.49", "GF"],
    ]},
    { c: "Family Specials", items: [
      ["Family Mixed Grill", "A feast of mixed grill skewers for the whole table.", "$74.99", ""],
      ["Family Mixed Gyro", "Lamb/beef & chicken gyro spread for the family.", "$74.99", ""],
      ["Family Mixed Shawarma", "Chicken & beef shawarma to share.", "$74.99", ""],
      ["Family Falafel Platter", "A generous vegan falafel spread for the table.", "$53.99", "Vegan"],
    ]},
    { c: "Burgers", items: [
      ["Angus Beef Burger", "Char-grilled Angus beef burger.", "$14.49", ""],
      ["Cheeseburger", "Angus burger with melted cheese.", "$15.49", ""],
      ["Philly Steak & Cheese Sub", "Griddled steak, onion, pepper & cheese.", "$14.99", ""],
    ]},
    { c: "Quesadillas", items: [
      ["Cheese Quesadilla", "Griddled tortilla with melted cheese.", "$9.49", "Veg"],
      ["Chicken Quesadilla", "With grilled chicken & cheese.", "$11.49", ""],
      ["Steak Quesadilla", "With grilled steak & cheese.", "$12.49", ""],
    ]},
    { c: "Sides", items: [
      ["Fries Basket", "Golden fries.", "$6.49", "Veg"],
      ["Seasoned Fries Basket", "Fries with Mediterranean seasoning.", "$6.99", "Veg"],
      ["Sweet Potato Fries", "Crisp sweet potato fries.", "$8.49", "Veg"],
      ["Garlic Rice", "Fragrant garlic rice.", "$4.49", "Vegan"],
      ["Chicken Wings", "Grilled or fried wings.", "$12.99–$19.99", ""],
    ]},
    { c: "Kids Meals", items: [
      ["Chicken Tenders", "Three tenders for the little ones.", "$10.99", ""],
      ["Kid Cheeseburger", "A smaller cheeseburger.", "$10.49", ""],
    ]},
    { c: "Desserts", items: [
      ["Homemade Baklava", "Layered phyllo, nuts & honey, made in-house.", "$6.49", "Veg"],
      ["NY Cheesecake", "Classic New York cheesecake.", "$6.49", "Veg"],
      ["Tiramisu", "Coffee-soaked layers.", "$7.49", "Veg"],
    ]},
    { c: "Drinks", items: [
      ["Tropical Smoothies", "Fresh fruit smoothies.", "$9.49", ""],
      ["Hot Beverages", "Coffee & tea. (16 oz)", "$5.99", ""],
    ]},
  ];

  const leaf = '<svg class="leaf" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 21c6-2 9-7 9-14-6 1-11 4-11 10"/><path d="M12 21c0-5-2-8-6-9"/></svg>';

  /* dish-name -> harvested photo (assets/photos/). Aliases cover menu
     variants that share one photo on the ordering system. */
  const PHOTOS = {
    "hummus": "hummus.png", "lily's ultimate hummus": "lily-s-ultimate-hummus.png",
    "baba ghanouj": "baba-ghanouj.png", "batata harrah": "batata-harrah.png",
    "cheese spring roll": "homemade-cheese-spring-roll.png", "falafel": "falafel-humus-and-cucumber.png",
    "grape leaves": "grape-leaves.png", "homemade spinach pie": "homemade-meat-pie.png",
    "kibbeh": "kibbeh.png", "ultimate cold mezza": "ultimate-cold-mezza.png",
    "greek salad": "greek-salad.png", "fattoush salad": "fattoush-salad.png",
    "tabbouleh": "tabbouleh.png", "caesar salad": "caesar-salad.png",
    "chicken caesar salad": "caesar-salad.png", "shrimp caesar salad": "caesar-salad.png",
    "homemade lentil soup": "homemade-lentil-soup.png", "homemade pumpkin soup": "homemade-pumpkin-soup.png",
    "lamb & beef gyro wrap": "lamb-beef-gyro-wrap.png", "chicken gyro wrap": "chicken-gyro-wrap.png",
    "chicken shawarma wrap": "chicken-shawarma-wrap.png", "beef shawarma wrap": "beef-shawarma-wrap.png",
    "shish tawouk wrap": "shish-tawouk-wrap.png", "falafel wrap": "shish-tawouk-wrap.png",
    "hummus & tabbouleh wrap": "hummus-tabbouleh-wrap.png",
    "lily's mixed grill platter": "lily-s-mixed-grill-platter.png", "mixed grill platter": "mixed-grill-platter.png",
    "bone-in lamb chops platter": "bone-in-lamb-chops-platter.png", "beef kabob platter": "tawouk-platter-chicken-kabob.png",
    "beef kafta platter": "beef-kafta-platter.png", "best friend platter": "best-friend-platter.png",
    "chicken shawarma platter": "chicken-shawarma-platter.png", "lamb & beef platter": "lamb-beef-gyro-platter.png",
    "jumbo shrimp platter": "grilled-shrimp-platter.png",
    "grilled chicken bowl": "grilled-chicken-bowl.png", "falafel bowl": "falafel-bowl.png",
    "family mixed grill": "family-mixed-grill.png", "family mixed gyro": "family-mixed-gyro.png",
    "family mixed shawarma": "family-mixed-shawarma.png", "family falafel platter": "family-falafel-platter.png",
    "cheeseburger": "cheeseburger.png", "kid cheeseburger": "kid-cheeseburger.png",
    "cheese quesadilla": "chicken-quesadilla.png", "chicken quesadilla": "chicken-quesadilla.png",
    "steak quesadilla": "steak-quesadilla.png",
    "seasoned fries basket": "seasoned-fries-basket.png", "sweet potato fries": "sweet-potato-french-fries.png",
    "garlic rice": "garlic-rice.png",
    "homemade baklava": "baklava.png", "ny cheesecake": "ny-cheesecake.png", "tiramisu": "tiramisu.png",
  };

  /* ---- render menu ---- */
  const tabs = document.getElementById("menuTabs");
  const body = document.getElementById("menuBody");
  if (tabs && body) {
    MENU.forEach((cat, i) => {
      const id = "cat-" + cat.c.toLowerCase().replace(/[^a-z]+/g, "-");
      const b = document.createElement("button");
      b.textContent = cat.c;
      b.dataset.target = id;
      if (i === 0) b.classList.add("active");
      tabs.appendChild(b);

      const sec = document.createElement("div");
      sec.className = "menu-cat";
      sec.id = id;
      let rows = "";
      cat.items.forEach(([n, d, p, tag]) => {
        const ph = PHOTOS[n.toLowerCase()];
        const thumb = ph
          ? `<span class="mi-thumb photo"><img loading="lazy" src="assets/photos/${ph}" alt=""></span>`
          : `<span class="mi-thumb none" aria-hidden="true"></span>`;
        rows += `<div class="menu-item${ph ? " has-thumb" : ""}">${thumb}<span class="mi-name">${n}${tag ? `<span class="tag">${tag}</span>` : ""}</span><span class="mi-price">${p}</span><span class="mi-desc">${d}</span></div>`;
      });
      sec.innerHTML = `<h3>${leaf}${cat.c}</h3><div class="menu-list">${rows}</div>`;
      body.appendChild(sec);
    });
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      tabs.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      const el = document.getElementById(btn.dataset.target);
      if (el) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
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
      document.body.style.overflow = open ? "hidden" : "";
    };
    toggle.addEventListener("click", () => set(!mm.classList.contains("open")));
    mm.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => set(false)));
  }

  /* ---- reveal on scroll ---- */
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }

  /* ---- magnetic order button ---- */
  const mag = document.getElementById("magnet");
  if (mag && !reduce && window.matchMedia("(pointer:fine)").matches) {
    let raf = 0;
    mag.addEventListener("pointermove", (e) => {
      const r = mag.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.25;
      const y = (e.clientY - r.top - r.height / 2) * 0.35;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { mag.style.transform = `translate(${Math.max(-7, Math.min(7, x))}px, ${Math.max(-6, Math.min(6, y))}px)`; });
    });
    mag.addEventListener("pointerleave", () => { cancelAnimationFrame(raf); mag.style.transform = ""; });
  }

  /* ---- live open/closed pill + today highlight ----
     Consensus hours (Google/Yelp/Sauce agree): Wed 4-9pm, Fri/Sat till 11pm. */
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
  if (row) row.classList.add("today");
})();
