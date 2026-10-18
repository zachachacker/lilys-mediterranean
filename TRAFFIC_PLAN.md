# Traffic plan: why the new site gets few orders (2026-10-18)

## Diagnosis

**The site converts. People never reach it.** From 7–17 Oct: 249 home visits →
74 order-page visits → 17 checkouts → 17 paid (16 real orders and 1 test). No paid checkout was lost, and
23% of order-page visitors buy. Traffic is about 40 page views a day, almost all
from people who already had the link.

| # | Leak | Evidence | Impact |
|---|---|---|---|
| 1 | **The old site is live and takes orders through Sauce.** `lilysmediterranean.com` (WordPress by Sauce, Cloudflare) returns 200 with 11 "Order online" links to `getsauce.com/order/lilys-mediterranean-fresh-grill` and 3 catering links. It has its own sitemap, a self-canonical tag and GA4 `G-CTCJHL724T`. | curl, 18 Oct | **Highest.** It's the top search result for "Lily's", and Facebook and Wanderlog link to it, and its orders never show up in our numbers. |
| 2 | **The new domain has 0 pages in Google.** `site:lilysmediterraneanfresh.com` returns nothing. The domain went live on 7 Oct, there's no Search Console verification, and it doesn't rank for brand or generic searches. | search, 18 Oct | **Highest.** Without indexing, search traffic can't reach the new site at all. |
| 3 | **For a "Lily's" search, the old Sauce site is the top result**, even though the Google Business Profile already links to the new site (Zachary confirmed this on 18 Oct). Searchers click the first result and order on Sauce. | Zachary, 18 Oct | High. Fixed by the redirect plus Change of address (steps 2–3). |
| 4 | **"Order online" searches go to the apps.** DoorDash (2,000+ reviews), DoorDash's own order.online pages (store 1455015), Uber Eats, Postmates and Grubhub all rank. | search | High. The demand exists, but it's on the apps at 15–30% commission. |
| 4b | **Google's "Order online" button shows ChowNow as "Preferred by this business"** (18 Oct). In the manager view, lilysmediterraneanfresh.com is set as preferred, and Zachary has set it twice. The public list shows ChowNow, ChowNow Local, the new site, Sauce, Square, the old domain and HoneyCart: 7 places to order, 5 of them not ours. | Zachary's screenshots, 18 Oct | High: it's the button people tap on the Google listing. |
| 5 | **Catering goes elsewhere:** HoneyCart (`lilysmediterraneanfreshgrill.gethoneycart.com`), ezCater ($150 minimum) and Sauce catering. None of these point to `/catering.html`. | search | Medium |
| 6 | **Wrong Wednesday hours.** Yelp and Restaurantji show Wed 4–9pm and ezCater shows Wednesday delivery, but Lily's is closed on Wednesdays. | search snippets | Medium: wasted trips and bad reviews |
| 7 | **Google Ads sent 3 visits in 11 days.** The identity verification deadline is **18 Oct**, and the ads' final URL is unknown (it may be the old site or Sauce). | site_events | Medium (paid traffic wasted) |
| 8 | **Print isn't scanned:** flyer 2 visits, sticker 1. Yelp sent 15 visits and none reached the order page. | site_events | Low–medium |
| 9 | **Competition.** Skewers Mediterranean Grille (144 5th Ave, same street) leads "mediterranean restaurant Indialantic". Lily's has 17 TripAdvisor reviews. | search | Long-term |
| 10 | ~~Our own order buttons linked to Uber Eats, DoorDash and Grubhub; on phones the order page showed no food until the second screen; the wait-time copy disagreed.~~ | | **Fixed 18 Oct** (4623fe6) |

**The number we're missing:** how many orders Sauce took in the last 30 days.
It's in Karim's Sauce dashboard. That's how many orders the redirect in step 2
can move to the new site, and it should be the first thing we get.

## Plan

### Step 1: today and tomorrow (Karim, about 15 minutes each)
0. **Find out what keeps resetting the preferred ordering link.** Check Business Profile → ⋮ → Business Profile settings → **People and access**: every manager is listed there. Remove any company Karim no longer works with (Sauce, ChowNow, the old website agency). A provider that has its own Google link can also send its own "preferred" status. Then remove every provider he doesn't use from Food ordering → Edit service providers. A link Google won't remove has to be delisted by that provider. If ChowNow shows as preferred again **after** that, someone or something with access is still changing it.
1. **Google Ads verification.** It's due today, or the ads pause.
2. **Google Business Profile** (business.google.com; add Zachary as Manager so he can do the rest):
   - Website: already the new site. Add `?src=gbp` so these visits show separately: `https://lilysmediterraneanfresh.com/?src=gbp`
   - Menu link: `https://lilysmediterraneanfresh.com/menu.html?src=gbp`
   - Order online: add `https://lilysmediterraneanfresh.com/order.html?src=gbp-order` and set it as the **preferred** ordering link, ahead of DoorDash, Uber Eats and Sauce.
   - Hours: check that Wednesday shows **Closed**.
3. **Google Ads:** set every ad's final URL to `https://lilysmediterraneanfresh.com/order.html?src=google-ads`.
   Keep auto-tagging on. The conversion tag is already on the new site.

### Step 2: Monday (the DNS call): redirect the old domain
> **Updated 18 Oct: preferred route.** Once Karim has the domain back at GoDaddy,
> `lilysmediterranean.com` becomes the **main** domain (it holds the Google ranking and
> matches his email), and `lilysmediterraneanfresh.com` 301s to it. The redirect below
> (old → fresh) is the fallback if getting the domain back stalls. Zoho records stay
> untouched either way.

The old domain's email runs on **Zoho** (MX `mx.zoho.com`, `mx2`, `mx3`). Leave the
MX and TXT (SPF/DKIM) records **exactly as they are**, or Karim's
`info@lilysmediterranean.com` email stops working. DNS is on Cloudflare
(`marissa`/`santino.ns.cloudflare.com`). Find out whether Karim's own Cloudflare
account or Sauce's holds it.

In Cloudflare, go to **Rules → Redirect Rules** and add one rule:
- When: hostname is `lilysmediterranean.com` **or** `www.lilysmediterranean.com`
- Then: dynamic redirect, **301**, to
  `concat("https://lilysmediterraneanfresh.com", http.request.uri.path, "?src=old-site")`

The A/CNAME records must stay **proxied** (orange cloud) for the rule to run.
The new site's `404.html` (shipped 18 Oct) sends each old page to its new page:
`/home/` → `/`, `/catering/` → `/catering.html`, `/were-hiring/` → `/careers.html`,
`/about-us/` and `/our-story/` → `/#story`, `/contact-us/` → `/#visit`, `/events/` → `/catering.html`,
`/terms-and-policies/` → `/privacy.html`. Visits from the old site show up as
source `old-site` on the dashboard.

Then decide about **Sauce**: switch its ordering off, or keep it only for the
"free delivery over $60" customers, and ask Sauce to delist
`getsauce.com/order/lilys-mediterranean-fresh-grill` from search. Before
switching it off, compare its fees and order volume.

### Step 3: the same day: get the new site into Google
1. **Search Console**: add `lilysmediterraneanfresh.com` as a Domain property, verified with a DNS TXT record at the registrar, and `lilysmediterranean.com`, verified with a TXT record in Cloudflare.
2. Submit `https://lilysmediterraneanfresh.com/sitemap.xml`, then use URL Inspection → Request indexing for `/`, `/menu.html`, `/order.html` and `/catering.html`.
3. Once the 301 is live: in the **old** property, go to Settings → **Change of address** → the new domain. This tells Google to move the old site's rankings to the new one.
4. Bing Webmaster Tools → Import from Search Console.

### Step 4: week 1–2: listings, all pointing to the new site with the correct hours
| Where | Change |
|---|---|
| Yelp (business account) | Website `?src=yelp`, Wednesday **Closed**, ordering link to `/order.html?src=yelp` |
| Facebook page | Website and the "Order food" button to the new site |
| Instagram @lilysmediterranean | Bio link `?src=instagram`; retire or merge the duplicate **@lilys_mediterranean_grill** |
| Apple Business Connect, Bing Places | Website and hours |
| TripAdvisor | Website |
| ezCater | Wednesday closed |
| HoneyCart | Retire it, or link it to `/catering.html?src=honeycart` |
| DoorDash, Uber Eats, Grubhub | Keep them (they bring orders), but put the bag sticker or QR flyer in **every** app bag. The app customer is the cheapest one to move to direct ordering. |

### Step 5: weeks 2–6: grow demand
- **Reviews:** the review-request emails exist. Check that they send after every order. The aim is more Google reviews than Skewers.
- **Google Ads**, once landing pages and verification are sorted: search campaigns within about 6 miles for brand terms plus "mediterranean / gyro / shawarma near me", weighted to 11am–3pm and 5–9pm (15 of the 16 real orders came in those hours). Track by the purchase conversion.
- **Google Business Profile posts** weekly: lunch specials, BOGO offers.
- **In store:** a QR card at the counter and on tables, the sticker on every bag (in-store orders too), and staff saying "order direct next time, it's cheaper".
- **Lily's Club:** offer the join as a one-tap button on the order-confirmed page (2 of 13 buyers tick it at checkout).

## Measurement
The dashboard's sources split by `src`: `gbp`, `gbp-order`, `old-site`, `google-ads`,
`yelp`, `instagram`, `flyer`, `sticker`. Check weekly:
1. Pages indexed (Search Console). Expect the first pages within days of submitting; not guaranteed.
2. Visits per day by source. Today's baseline is about 25 home visits a day.
3. Orders per day. Today's baseline is about 1.5 a day; the goal is 15 on weekdays and 20 at weekends.
4. Sauce and app order counts, from Karim's dashboards, to check that orders are moving to the site rather than disappearing.

Karim's goal is about 10× today's orders. That can't come from new demand
inside a month. It has to come from moving the orders Lily's already gets on
Sauce and the apps onto the new site, which is what steps 1–4 do.
