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
  /* Website prices run 3% above the printed in-house menu (Kareem, 2026-07-25)
     — it offsets the card fee. The MENU below always holds the IN-HOUSE prices
     exactly as printed; every online surface (menu page, order page, and the
     server's menu_items table via scripts/sync-menu.mjs) derives from these,
     so what a customer sees can never drift from what they're charged.
     Ranges / call-to-order items are left as printed — those are phone orders. */
  onlineMarkup: 0.03,
  onlineCents(inHouseCents) {
    return Math.round((inHouseCents * (1 + this.onlineMarkup)) / 5) * 5; // nearest 5¢
  },
  onlinePrice(printed) {
    const m = /^\$(\d+)\.(\d{2})$/.exec(printed);
    if (!m) return printed;
    return `$${(this.onlineCents(Number(m[1]) * 100 + Number(m[2])) / 100).toFixed(2)}`;
  },
  phone: "(321) 312-4444",
  phoneHref: "tel:+13213124444",
  address: "2 5th Ave STE C, Indialantic, FL 32903",
  email: "info@lilysmediterranean.com",
  orderUrl: "order.html", // our own ordering — direct to the kitchen
  instagram: "https://www.instagram.com/lilysmediterranean/",
  directionsUrl: "https://www.google.com/maps/dir/?api=1&destination=2+5th+Ave+STE+C+Indialantic+FL+32903",
  reviewsUrl: "https://www.google.com/maps/search/?api=1&query=Lily%27s+Mediterranean+Fresh+Grill+2+5th+Ave+Indialantic+FL+32903",
  delivery: {
    partners: [
      ["Uber Eats", "https://www.ubereats.com/store/lilys-mediterranean-fresh-grill/752UXD00Qw-XS5lr6NQu6g"],
      ["DoorDash", "https://www.doordash.com/store/lily's-mediterranean-fresh-grill-indialantic-1455015/"],
      ["Grubhub", "https://www.grubhub.com/restaurant/lilys-mediterranean-fresh-grill-2-5th-ave-indialantic/2515084"],
    ],
  },
  payments: "Pay online by card when you order for pickup; cards accepted in store.",
  // online ordering backend (anon key is public by design — safe to ship)
  ORDERING: {
    supabaseUrl: "https://hytvfqydahwsrcdbnvfq.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5dHZmcXlkYWh3c3JjZGJudmZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDk3NDYsImV4cCI6MjA5OTc4NTc0Nn0.taAfp5xGFYdxyNxeszmxEt5Me-PPNfUbXfs4suLvXt0",
    taxRate: 0.07, // FL 6% + Brevard 1% — confirm with Kareem
    prepMinutes: "30", // pickup (Kareem, 2026-10-07)
    deliveryMinutes: "40",
  },
  // 0=Sun..6=Sat; [open, close] in 24h, null = closed that day.
  // CONFIRMED by Kareem at the 2026-07-11 meeting: Mon/Tue 11-10, Wed CLOSED,
  // Thu 11-10, Fri/Sat 11-11, Sun 11-10.
  HOURS: { 0: [11, 22], 1: [11, 22], 2: [11, 22], 3: null, 4: [11, 22], 5: [11, 23], 6: [11, 23] },
  halal: true, // confirmed by owner — halal AND kosher
  // the eight Kareem marks as guest favourites on the printed menu (2026-07-25).
  // Names must match MENU entries exactly — the ✦ is looked up by name.
  signatures: [
    "Lily's Ultimate Hummus", "Chicken Shawarma Wrap", "Lamb & Beef Gyro Wrap",
    "Chicken Gyro Wrap", "Mixed Grill Platter", "Chicken Shawarma Platter",
    "Grilled Chicken Bowl", "Falafel Bowl",
  ],
  MENU: [
    { c: "Mezze & Starters", items: [
      ["Lily's Ultimate Hummus", "Creamy hummus topped with feta, olives and tomatoes, served with warm pita.", "$13.49", "Veg"],
      ["Hummus", "Our classic creamy hummus with tahini, lemon and olive oil, served with warm pita.", "$9.49", "Vegan"],
      ["Spicy Hummus", "The same classic hummus with a warm Mediterranean chilli kick.", "$9.99", "Vegan"],
      ["Baba Ghanouj", "Smoky roasted eggplant blended with tahini, lemon and olive oil, served with pita.", "$10.49", "Vegan"],
      ["Muhammara", "Roasted red pepper, walnut, breadcrumbs and olive oil — a Levantine classic.", "$9.99", "Vegan"],
      ["Moussaka", "Baked eggplant, onion, garlic and tomato, rich in flavour and tradition.", "$13.99", "Vegan"],
    ]},
    { c: "From the Kitchen", items: [
      ["Cheese Spring Roll", "Five phyllo rolls filled with mozzarella, feta and aromatic mint.", "$8.99", "Veg"],
      ["Batata Harrah", "Crispy potatoes sautéed with garlic, cilantro, lemon and chilli flakes.", "$9.49", "Vegan"],
      ["Grape Leaves", "Five grape leaves stuffed with seasoned lemon-herb rice.", "$8.99", "Vegan"],
      ["Falafel", "Four pieces of ground fava and chickpea, deep-fried to order.", "$7.49", "Vegan"],
      ["Homemade Kibbeh", "Three crispy bulgur and beef shells filled with seasoned beef and pine nuts.", "$15.99", ""],
      ["Homemade Spinach Pie", "Two flaky pastries stuffed with spinach, herbs and Mediterranean seasonings.", "$10.49", "Vegan"],
      ["Ultimate Cold Mezza", "A sampler of hummus, baba ghanouj, tabbouleh, falafel, grape leaves and three warm pitas.", "$25.99", "Vegan"],
    ]},
    { c: "Salads & Soup", items: [
      ["Greek Salad", "Romaine, tomatoes, cucumbers, feta, olives, pepperoncini and Greek dressing.", "$12.99", "Veg"],
      ["Tabbouleh", "Fresh parsley, tomatoes, cracked wheat, lemon juice and olive oil.", "$15.99", "Vegan"],
      ["Fattoush Salad", "Crispy pita chips, lettuce, cucumber, tomato, onion, green pepper and tangy sumac dressing.", "$12.99", "Vegan"],
      ["Caesar Salad", "Crisp romaine, parmesan, croutons and Caesar dressing.", "$12.49", "Veg"],
      ["Chicken Caesar Salad", "Classic Caesar topped with grilled marinated chicken.", "$14.99", ""],
      ["Shrimp Caesar Salad", "Fresh grilled shrimp over a traditional Caesar salad.", "$15.49", ""],
      ["Priest's Salad", "Al-Raheb — chunky smoky eggplant tossed with fresh vegetables, lemon, garlic and olive oil.", "$15.99", "Vegan"],
      ["Homemade Lentil Soup", "Slow-cooked lentils blended with Mediterranean herbs and spices.", "$8.99", "Vegan"],
      ["Homemade Pumpkin Soup", "Creamy pumpkin soup seasoned with warm Mediterranean spices.", "$10.49", "Vegan"],
    ]},
    { c: "Wraps, Gyros & Subs", items: [
      ["Chicken Shawarma Wrap", "Marinated chicken, garlic sauce, pickles and lettuce.", "$12.49", ""],
      ["Beef Shawarma Wrap", "Thinly sliced marinated beef, tomato, onion, turnip and tahini sauce.", "$14.99", ""],
      ["Mixed Shawarma Wrap", "Beef and chicken shawarma with hummus, pickles and tomatoes over garlic sauce.", "$14.99", ""],
      ["Beef Kafta Wrap", "Chargrilled seasoned ground beef with hummus, tomatoes, pickles, onion and tahini.", "$13.99", ""],
      ["Lamb & Beef Gyro Wrap", "Spiced gyro meat with grilled green pepper, onion, feta, tomatoes and lettuce, topped with tzatziki. Ask for it spicy.", "$13.99", ""],
      ["Chicken Gyro Wrap", "Seasoned chicken gyro with grilled pepper, onion, feta, tomatoes, lettuce and tzatziki. Ask for it spicy.", "$13.49", ""],
      ["Garlic Rice Chicken Wrap", "Fried chicken, green pepper, provolone, garlic rice, red onion, tomatoes and lettuce with mayo.", "$15.49", ""],
      ["Falafel Wrap", "Crispy falafel with lettuce, tomatoes, pickles and tahini sauce.", "$11.99", "Vegan"],
      ["Falafel Gyro Style Wrap", "Crispy falafel, tomatoes, lettuce, feta and tzatziki sauce.", "$12.99", "Veg"],
      ["Hummus & Tabbouleh Wrap", "Fresh hummus and tabbouleh with pickles, wrapped in warm pita.", "$12.99", "Vegan"],
      ["Eggplant & Cauliflower Wrap", "Fried eggplant and cauliflower, turnip, lettuce, tomatoes, hummus and pickles with tahini.", "$12.99", "Vegan"],
      ["Philly Steak & Cheese Sub", "Strip steak, green pepper, onion, mushroom, mayo and provolone.", "$14.99", ""],
      ["Chicken Philly Cheesesteak Sub", "Grilled chicken, sautéed bell peppers and onion topped with melted cheese.", "$14.99", ""],
      ["Chicken Fajita Sub", "Seasoned chicken, grilled onion and green pepper, guacamole and melted cheese.", "$14.99", ""],
    ]},
    { c: "Lily's Platters", items: [
      ["Mixed Grill Platter", "Three skewers — chicken, tenderloin and kafta kabob — with hummus, small salad and garlic sauce.", "$23.99", ""],
      ["Lily's Mixed Grill Platter", "Four skewers of grilled chicken, tenderloin, kafta and shrimp, with hummus and garlic sauce.", "$26.49", ""],
      ["Lamb & Beef Gyro Platter", "Seasoned gyro topped with feta, grilled onion, tomato, green pepper and tzatziki.", "$21.49", ""],
      ["Best Friend Platter", "Two skewers of chicken kabob, tabbouleh, two grape leaves and garlic sauce.", "$22.99", ""],
      ["Chicken Shawarma Platter", "Marinated chicken shawarma with rice, salad and garlic sauce.", "$18.99", ""],
      ["Beef Shawarma Platter", "Tender shaved beef shawarma with traditional Mediterranean sides.", "$21.99", ""],
      ["Tawouk Platter", "Two marinated chicken kabob skewers grilled over an open flame.", "$20.99", ""],
      ["Beef Kafta Platter", "Two skewers of seasoned ground beef, grilled and served with hummus.", "$17.99", ""],
      ["Beef Kabob Platter", "Two shish kabob skewers of tenderloin beef with a small house salad and hummus.", "$21.49", ""],
      ["Lamb Kabob Platter", "Two skewers of juicy lamb seasoned with authentic herbs and spices, served with hummus.", "$25.99", ""],
      ["Bone-In Lamb Chops Platter", "Three marinated lamb chops with garlic rice, house salad and hummus.", "$26.99", ""],
      ["Chicken Gyro Platter", "Seasoned grilled chicken topped with feta, grilled green pepper, onion and tzatziki.", "$19.99", ""],
      ["Jumbo Shrimp Platter", "Two skewers of grilled shrimp with rice, salad, aioli and garlic sauce.", "$24.99", ""],
    ]},
    { c: "Lily's Bowls", items: [
      ["Grilled Chicken Bowl", "Grilled chicken over rice with hummus, salad and garlic sauce.", "$16.99", ""],
      ["Falafel Bowl", "Falafel with rice, salad, hummus, pickles and tahini sauce.", "$14.99", "Vegan"],
      ["Shrimp Bowl", "Grilled shrimp over rice with Mediterranean garlic aioli.", "$18.49", ""],
      ["Eggplant & Cauliflower Bowl", "Fried eggplant and cauliflower over rice with hummus, house salad and tahini.", "$15.99", "Vegan"],
    ]},
    { c: "Family Specials", items: [
      ["Family Mixed Grill", "Three skewers each of chicken, tenderloin and kafta kabob with rice, batata harrah, hummus, garlic sauce, tzatziki and six pitas. Gluten-free apart from the pita — gluten-free pita available +$1.99.", "$84.99", ""],
      ["Family Mixed Gyro", "Lamb and chicken gyro meat with rice, batata harrah, Greek salad, tzatziki, hummus and six pitas. Gluten-free apart from the pita — gluten-free pita available +$1.99.", "$84.99", ""],
      ["Family Mixed Shawarma", "Chicken and beef shawarma served family style with batata harrah, salad, hummus, garlic sauce and six pitas. Gluten-free apart from the pita — gluten-free pita available +$1.99.", "$84.99", ""],
      ["Family Bone-In Lamb Chops", "Nine marinated lamb chops with garlic rice, house salad, hummus and six pitas. Gluten-free apart from the pita — gluten-free pita available +$1.99.", "$84.99", ""],
      ["Family Falafel Platter", "Fresh falafel, batata harrah, salad, hummus, tahini sauce and pita for the table. Gluten-free apart from the pita — gluten-free pita available +$1.99.", "$53.99", ""],
    ]},
    { c: "Burgers", items: [
      ["Angus Cheeseburger", "Angus beef patty, provolone, tomatoes, onion, mayo and ketchup.", "$14.49", ""],
      ["Beef Kafta Burger", "Kafta ground beef patty, lettuce, tomatoes, onion, mayo and ketchup.", "$15.49", ""],
      ["Chicken Burger", "Seasoned chicken kafta, cheese, garlic sauce, lettuce and pickles.", "$15.49", ""],
    ]},
    { c: "Quesadillas", items: [
      ["Cheese Quesadilla", "Griddled tortilla with melted cheese.", "$9.49", "Veg"],
      ["Chicken Quesadilla", "With grilled chicken & cheese.", "$11.99", ""],
      ["Steak Quesadilla", "With grilled steak & cheese.", "$12.49", ""],
    ]},
    { c: "Sides & Wings", items: [
      ["Fries Basket", "Golden fries.", "$6.49", "Veg"],
      ["Seasoned Fries Basket", "Fries with Mediterranean seasoning.", "$6.99", "Veg"],
      ["Sweet Potato Fries", "Crisp sweet potato fries.", "$8.49", "Veg"],
      ["Garlic Rice", "Fragrant garlic rice.", "$5.99", "Vegan"],
      ["Chicken Wings (6 pc)", "Choice of Buffalo sauce, BBQ or Garlic Parmesan.", "$12.99", ""],
      ["Chicken Wings (12 pc)", "Choice of Buffalo sauce, BBQ or Garlic Parmesan.", "$20.99", ""],
    ]},
    { c: "Kids", items: [
      ["Chicken Tenders", "Three tenders, served with fries.", "$10.99", ""],
      ["Kid Burger", "Beef, cheese, mayo and ketchup.", "$10.49", ""],
      ["Kid Cheese Sandwich", "Two slices of bread toasted with melted cheddar.", "$7.99", "Veg"],
    ]},
    { c: "Desserts", items: [
      ["Homemade Baklava", "Layered phyllo, nuts and honey.", "$6.99", "Veg"],
      ["New York Cheesecake", "", "$6.49", ""],
      ["Tiramisu", "Coffee-soaked layers.", "$7.99", "Veg"],
      ["Homemade Vegan Brownie", "", "$6.99", "Vegan"],
      ["Homemade Banana Bread", "", "$6.99", ""],
      ["Homemade Coconut Cake", "", "$6.99", ""],
    ]},
    /* Not on the printed menu — carried over from the live site. Confirm with Kareem. */
    { c: "Drinks", items: [
      ["Tropical Smoothies", "Fresh fruit smoothies.", "$9.49", ""],
      ["Hot Beverages", "Coffee & tea. (16 oz)", "$5.99", ""],
    ]},
  ],
};
