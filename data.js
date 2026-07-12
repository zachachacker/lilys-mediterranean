/* Lily's — single source of truth for site + chatbot.
   Every fact here is real (site/Sauce/Google); nothing invented.
   Items: [name, description, price, tag] — tag: Vegan | Veg | GF | "" */
window.LILYS = {
  timeZone: "America/New_York", // the restaurant's clock — open/closed is ALWAYS computed in Florida time
  /** Current {day, hour} in the restaurant's timezone, wherever the visitor is. */
  nowInTz() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timeZone, weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const hour = (parseInt(get("hour"), 10) % 24) + parseInt(get("minute"), 10) / 60;
    return { day: day >= 0 ? day : new Date().getDay(), hour };
  },
  phone: "(321) 312-4444",
  phoneHref: "tel:+13213124444",
  address: "2 5th Ave STE C, Indialantic, FL 32903",
  email: "info@lilysmediterranean.com",
  orderUrl: "https://www.lilysmediterraneanfl.com/order",
  instagram: "https://www.instagram.com/lilysmediterranean/",
  directionsUrl: "https://www.google.com/maps/dir/?api=1&destination=2+5th+Ave+STE+C+Indialantic+FL+32903",
  reviewsUrl: "https://www.google.com/maps/search/?api=1&query=Lily%27s+Mediterranean+Fresh+Grill+2+5th+Ave+Indialantic+FL+32903",
  delivery: {
    promo: "Free delivery on orders above $60.",
    partners: [
      ["Uber Eats", "https://www.ubereats.com/store/lilys-mediterranean-fresh-grill/752UXD00Qw-XS5lr6NQu6g"],
      ["DoorDash", "https://www.doordash.com/store/lily's-mediterranean-fresh-grill-indialantic-1455015/"],
      ["Grubhub", "https://www.grubhub.com/restaurant/lilys-mediterranean-fresh-grill-2-5th-ave-indialantic/2515084"],
    ],
  },
  payments: "Cards, Google Pay and Venmo (via our online ordering).",
  // 0=Sun..6=Sat; [open, close] in 24h, null = closed that day.
  // CONFIRMED by Kareem at the 2026-07-11 meeting: Mon/Tue 11-10, Wed CLOSED,
  // Thu 11-10, Fri/Sat 11-11, Sun 11-10.
  HOURS: { 0: [11, 22], 1: [11, 22], 2: [11, 22], 3: null, 4: [11, 22], 5: [11, 23], 6: [11, 23] },
  halal: true, // confirmed by owner — halal AND kosher
  signatures: [
    "Lamb & Beef Gyro Wrap", "Lily's Ultimate Hummus", "Lily's Mixed Grill Platter",
    "Chicken Shawarma Wrap", "Batata Harrah", "Bone-In Lamb Chops Platter", "Homemade Baklava",
  ],
  MENU: [
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
  ],
};
