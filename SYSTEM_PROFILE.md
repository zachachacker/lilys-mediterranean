# SYSTEM_PROFILE.md — Lily's Mediterranean Fresh Grill

Read-only security reconnaissance pass. Every claim below cites `file:line`. Anything
that could not be established from the repository is marked `UNVERIFIED` with the
artifact that would resolve it.

- Repo: `/Users/caldy/Projects/lilys-mediterranean`, branch `main`, remote
  `https://github.com/zachachacker/lilys-mediterranean.git` (verified via `git remote -v`).
- Commit at time of scan: `ab6762a` "Square as the payment provider, Stripe kept one config row away".
- Scope: a static marketing/ordering site plus 8 Supabase Edge Functions. There is no
  application server, no `package.json`, and no build step.

---

# A. Foundation

## 1. Stack & runtime

| Aspect | Finding | Evidence |
|---|---|---|
| Front-end language | Vanilla ES2020+ JavaScript, IIFE modules, no framework, no bundler | [order.js:5](order.js:5) `(() => { "use strict";`, [main.js:2](main.js:2), [chat.js:5](chat.js:5), [kitchen.js:12](kitchen.js:12) |
| Front-end delivery | Pure static HTML. 5 pages, all scripts loaded as classic `<script src>` at end of body | [order.html:140-143](order.html:140), [index.html:374-376](index.html:374), [menu.html:131-133](menu.html:131), [kitchen.html:221](kitchen.html:221), [order-confirmed.html:46-47](order-confirmed.html:46) |
| Rendering model | **Static HTML + client-side DOM generation.** No SSR, no hydration, no SPA router. Menu and cart are built at runtime from `window.LILYS` | [main.js:146-167](main.js:146), [order.js:151-181](order.js:151) |
| Back-end language | TypeScript on **Deno** (Supabase Edge Functions) | [create-checkout/index.ts:39](supabase/functions/create-checkout/index.ts:39) `Deno.serve(async (req) => {`, `Deno.env.get` at [:67](supabase/functions/create-checkout/index.ts:67) |
| Back-end runtime version | **UNVERIFIED — no `supabase/config.toml`, no `deno.json`, no `import_map.json` in the repo.** Deno version is whatever Supabase's edge runtime pins. Resolve with: Supabase dashboard → Edge Functions → runtime version, or `supabase functions list` |
| Back-end dependency | `jsr:@supabase/supabase-js@2` — a **floating major-version specifier**, resolved at deploy/cold-start | identical import line in all 8 functions, e.g. [create-checkout/index.ts:5](supabase/functions/create-checkout/index.ts:5), [kitchen-api/index.ts:4](supabase/functions/kitchen-api/index.ts:4) |
| Package manager | **None.** No `package.json`, no `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `deno.lock`, `requirements.txt`, `go.mod`, or `composer.json` anywhere in the tree (verified by `find`) |
| Node usage | One build-time script only, run manually by a human | [scripts/sync-menu.mjs:5-7](scripts/sync-menu.mjs:5) imports `node:fs`, `node:url`, `node:path`. Node version unpinned — **UNVERIFIED**, no `.nvmrc` or `engines` field exists |
| TypeScript strictness | **N/A — no `tsconfig.json` exists.** The `.ts` files are type-annotated but compiled by Deno's built-in defaults. Deno defaults to `strict: true`, but this is **UNVERIFIED** for the Supabase edge runtime specifically; no config file in the repo asserts it |
| Dev server | Python `http.server` with caching disabled, port 8742, local only | [.claude/devserver.py:1-12](.claude/devserver.py:1), [.claude/launch.json:4-9](.claude/launch.json:4) |

## 2. Repo topology

Single repository, not a monorepo. No package boundaries, no workspaces.

| Path | Purpose | Deployed? |
|---|---|---|
| `index.html`, `menu.html`, `order.html`, `order-confirmed.html` | Public customer-facing pages | **Yes** — GitHub Pages |
| `kitchen.html` | Kitchen display system (KDS) for staff tablet | **Yes — same origin, publicly reachable** ([kitchen.html:6](kitchen.html:6) only sets `noindex`) |
| `main.js` | Menu render, nav, scroll reveal, open/closed pill | Yes |
| `order.js` | Cart, checkout submit, confirmation-page polling | Yes |
| `kitchen.js` | KDS board, polling, optimistic status taps, offline queue | Yes |
| `chat.js` | "Ask Lily's" client-side rule-based concierge. No API, no LLM | Yes — [chat.js:1-4](chat.js:1) |
| `data.js` | Single source of truth: menu, hours, phone, **Supabase URL + anon key** | Yes |
| `styles.css` | 58 KB stylesheet | Yes |
| `supabase/functions/*` | 8 Deno Edge Functions — the entire back end | **Yes**, deployed to Supabase project `hytvfqydahwsrcdbnvfq` ([supabase/functions/README.md:1](supabase/functions/README.md:1)). Repo copies are declared canonical but deployment is manual ([README.md:3-4](supabase/functions/README.md:3)) |
| `scripts/sync-menu.mjs` | Generates `menu_items` sync SQL from `data.js`. Run manually | Build-time only, not deployed |
| `assets/photos/`, `assets/photos/thumbs/` | Dish photography (~120 files) | Yes |
| `assets/menu.json` | **Gitignored** ([.gitignore:1](.gitignore:1)) — not in the repo, not deployed from it |
| `assets/kds-icon-*.png`, `kitchen.webmanifest` | KDS PWA install assets | Yes |
| `.claude/` | Agent config, dev server, design-review data. **Gitignored** ([.gitignore:2](.gitignore:2)) | No |
| `old-site-archive/` | **Dead/legacy.** 33 photos + 25 scraped HTML pages from the previous MenuFi/Sauce site. **Gitignored** ([.gitignore:5](.gitignore:5)), never deployed | No — [old-site-archive/README.md](old-site-archive/README.md) |

Confirmed deployed set = `git ls-files` output (26 non-photo entries), all of which GitHub
Pages serves from the repository root.

**Dead code in the deployed bundle:** [main.js:8-97](main.js:8) carries a complete
90-line hardcoded duplicate of the menu as a fallback for `window.LILYS.MENU`. It is
unreachable in practice (every page loads `data.js` before `main.js`) but ships to every
visitor and is a second, silently-drifting copy of all prices.

## 3. Deployment & infrastructure

| Aspect | Finding | Evidence |
|---|---|---|
| Static host | **GitHub Pages**, `https://zachachacker.github.io/lilys-mediterranean/` | [README.md:8](README.md:8), corroborated by [supabase/functions/README.md:73](supabase/functions/README.md:73) |
| Build pipeline | **None.** No build step; GitHub Pages serves the repo root verbatim | [README.md:4](README.md:4) "Static site — HTML/CSS/JS, no build step" |
| CI/CD | **None.** No `.github/` directory exists (verified: `ls .github` → No such file or directory). No `vercel.json`, `netlify.toml`, `railway.json`, Dockerfile, or docker-compose anywhere | `find` for `*.yml/*.yaml/Dockerfile*/docker-compose*` returned nothing |
| Back-end deploy | **Manual**, via Supabase MCP `deploy_edge_function` or `supabase functions deploy` | [supabase/functions/README.md:3-4](supabase/functions/README.md:3) |
| Environments | **One. Production only.** There is no staging site, no staging Supabase project, and no environment switch in any config file. `app_config.site_url` is a single row | [create-checkout/index.ts:99](supabase/functions/create-checkout/index.ts:99) |
| Staging shares prod DB? | **N/A — there is no staging.** Testing is done against production with a `demo` flag on the order row ([create-checkout/index.ts:139](supabase/functions/create-checkout/index.ts:139)) and, per the runbook, live Square/Stripe test transactions ([supabase/functions/README.md:44](supabase/functions/README.md:44), [:84](supabase/functions/README.md:84)) |
| CDN / WAF / proxy | GitHub Pages sits behind Fastly (GitHub's CDN). **No WAF.** Supabase Edge Functions sit behind Cloudflare (Supabase's platform default) — **UNVERIFIED**, needs the Supabase dashboard to confirm whether any rate-limit or WAF rules are enabled |
| TLS termination | At GitHub Pages / Fastly for the site; at Supabase's edge for `*.supabase.co`. Neither is under this repo's control; no cert or TLS config exists here |
| Security headers | **None can be set.** GitHub Pages does not permit custom response headers, and no page sets a `Content-Security-Policy`, `Referrer-Policy`, `X-Frame-Options`, or `Permissions-Policy` via `<meta http-equiv>` (grep for `Content-Security-Policy` / `http-equiv` across all 5 HTML files returned zero matches) |
| `robots.txt` | **Absent** (`ls robots.txt` → No such file). Indexing is suppressed per-page only |

---

# B. Attack surface

## 4. Complete endpoint inventory

Base URL for all: `https://hytvfqydahwsrcdbnvfq.supabase.co/functions/v1/`
([data.js:49](data.js:49)). This is the **exhaustive** list — 8 functions, one file each,
each a single `Deno.serve` handler with no sub-router. There is no GraphQL, no RPC layer,
and no server-action framework in this codebase.

| Method | Path | Handler | Auth required? | Role required? | Rate limited? | Input validated by |
|---|---|---|---|---|---|---|
| `POST` / `OPTIONS` | `/create-checkout` | [create-checkout/index.ts:39](supabase/functions/create-checkout/index.ts:39) | Supabase JWT presumed (`verify_jwt` default) — but the **anon key is public** ([data.js:50](data.js:50)), so effectively **none** | None | **No** | Hand-rolled, inline: [:50-65](supabase/functions/create-checkout/index.ts:50) — name ≤80, phone ≥10 digits, ≤40 lines, qty integer 1–20, no duplicate ids |
| `GET` / `OPTIONS` | `/order-status?sid=` | [order-status/index.ts:13](supabase/functions/order-status/index.ts:13) | Same as above — effectively **none**; the unguessable `sid` is the real access control | None | **No** | [:16](supabase/functions/order-status/index.ts:16) — `sid` present and ≤200 chars only |
| `POST` / `OPTIONS` | `/kitchen-api` (`action: "list"`) | [kitchen-api/index.ts:57](supabase/functions/kitchen-api/index.ts:57) | **Yes** — `x-kitchen-key` header vs `app_config.kitchen_key`, constant-time compare [:46](supabase/functions/kitchen-api/index.ts:46) | Single shared staff secret; no roles | **No** | Body must be JSON; `action` string switch |
| `POST` | `/kitchen-api` (`action: "advance"`) | [kitchen-api/index.ts:68](supabase/functions/kitchen-api/index.ts:68) | **Yes** — same shared key | Same | **No** | [:71-72](supabase/functions/kitchen-api/index.ts:71) — `to` must be a key of `ALLOWED_FROM`; `id` non-empty string. Transition guarded server-side by `.in("status", from)` [:77](supabase/functions/kitchen-api/index.ts:77) |
| `POST` | `/stripe-webhook` | [stripe-webhook/index.ts:31](supabase/functions/stripe-webhook/index.ts:31) | **HMAC signature only** — `verify_jwt` documented OFF ([:1-3](supabase/functions/stripe-webhook/index.ts:1)) | N/A | **No** | Signature verify [:44](supabase/functions/stripe-webhook/index.ts:44); then `JSON.parse` with **no schema validation** [:48](supabase/functions/stripe-webhook/index.ts:48) |
| `POST` | `/square-webhook` | [square-webhook/index.ts:32](supabase/functions/square-webhook/index.ts:32) | **HMAC signature only** — `verify_jwt` documented OFF ([:4-5](supabase/functions/square-webhook/index.ts:4)) | N/A | **No** | Signature verify [:56](supabase/functions/square-webhook/index.ts:56); event shape checked loosely [:71-80](supabase/functions/square-webhook/index.ts:71) |
| `POST` | `/notify-order` | [notify-order/index.ts:14](supabase/functions/notify-order/index.ts:14) | **NONE in the handler.** Intended caller is a DB trigger via `pg_net` ([:2](supabase/functions/notify-order/index.ts:2)) | None | **No** | [:23-24](supabase/functions/notify-order/index.ts:23) — `order_id` must be a non-empty string |
| `POST` | `/reconcile` | [reconcile/index.ts:11](supabase/functions/reconcile/index.ts:11) | **NONE in the handler.** Intended caller is `pg_cron` | None | **Yes — self-imposed**, one run per 5 min via `app_config.reconcile_last_run` [:22-25](supabase/functions/reconcile/index.ts:22) | Body ignored entirely |
| `POST` | `/daily-summary` | [daily-summary/index.ts:13](supabase/functions/daily-summary/index.ts:13) | **NONE in the handler.** Intended caller is `pg_cron` at 08:30 ET ([:2](supabase/functions/daily-summary/index.ts:2)) | None | **No** | Body ignored entirely |

**Additional attack surface not in the function list:** the Supabase **PostgREST API** at
`https://hytvfqydahwsrcdbnvfq.supabase.co/rest/v1/` is reachable with the public anon key.
The health-check commands preserved in [.claude/settings.local.json:12](.claude/settings.local.json:12)
show `GET /rest/v1/menu_items?select=id&limit=1` being called successfully with the anon
key, proving PostgREST is exposed and that at least `menu_items` is anon-readable. Whether
`orders` and `app_config` are equally reachable is **UNVERIFIED — see §15 and Blocking
Unknowns; this is the single highest-value open question in the whole report.**

**CORS:** `create-checkout`, `order-status`, and `kitchen-api` all set
`Access-Control-Allow-Origin: "*"` ([create-checkout/index.ts:8](supabase/functions/create-checkout/index.ts:8),
[order-status/index.ts:6](supabase/functions/order-status/index.ts:6),
[kitchen-api/index.ts:7](supabase/functions/kitchen-api/index.ts:7)). Any origin on the
internet can call them from a browser. The three trigger/cron functions set no CORS
headers at all.

## 5. Authentication

There is **no user authentication system**. No registration, no login, no password, no
session, no JWT issuance, no OAuth, no MFA, no account lockout, no password reset — because
there are no user accounts. Customers order as anonymous guests.

Three distinct credentials exist:

| Credential | Type | Client-side storage | Flags / lifetime | Evidence |
|---|---|---|---|---|
| Supabase **anon key** | JWT, `role: anon`, `iat` 2026-07-16, `exp` 2036-07-16 (**10-year lifetime**) | Hardcoded in shipped JS, sent as `apikey` + `Authorization: Bearer` | Not a cookie. No rotation mechanism in code | [data.js:50](data.js:50), duplicated at [kitchen.js:15](kitchen.js:15). Claims decoded locally from the public token; value **[REDACTED]** here |
| **Kitchen key** | Opaque shared secret, staff-typed | **`localStorage["lilys-kitchen-key"]`** — plaintext, no expiry, same origin as the public site | No rotation, no expiry, no lockout, no per-device identity | [kitchen.js:17](kitchen.js:17), written [:273](kitchen.js:273), read [:46](kitchen.js:46), sent [:142](kitchen.js:142); verified server-side [kitchen-api/index.ts:44-48](supabase/functions/kitchen-api/index.ts:44) |
| Order **`sid`** | Server-minted `crypto.randomUUID()` bearer token, prefixed `sq_` / `demo_`, or a real Stripe `cs_…` session id | Carried in the confirmation-page URL query string | No expiry — an `sid` grants order read forever | minted [create-checkout/index.ts:144](supabase/functions/create-checkout/index.ts:144), overwritten for Stripe at [:261](supabase/functions/create-checkout/index.ts:261), consumed [order-status/index.ts:22](supabase/functions/order-status/index.ts:22) |

- **Cookies: none.** No `Set-Cookie` anywhere; grep for `document.cookie` across all JS
  returns zero matches. Therefore `HttpOnly` / `Secure` / `SameSite` are **N/A**, and
  CSRF is structurally absent (all state changes require a custom header, and there is no
  ambient credential a cross-site request could ride on).
- **Password hashing: N/A** — no passwords exist. The kitchen key is compared as a raw
  string, not a hash ([kitchen-api/index.ts:46](supabase/functions/kitchen-api/index.ts:46)),
  and is stored in plaintext in `app_config`.
- **Token refresh: none.** The anon key is static for a decade; the kitchen key is static
  until manually changed.
- **MFA: none. Account lockout: none. Brute-force protection: none.**
- The kitchen login field is `type="password"` with `autocomplete="off"`
  ([kitchen.html](kitchen.html) `.k-login input`, rendered at [kitchen.js:266](kitchen.js:266)) —
  masked on screen, but the value lands in `localStorage` in clear text one line later.

## 6. Authorization

**Roles are not represented at all.** There is no role column, no claim, no permission
table, no middleware layer. Authorization is binary and per-handler:

- **Public (no check):** `create-checkout`, `order-status`, `notify-order`, `reconcile`,
  `daily-summary`.
- **Kitchen-key holder:** the two `kitchen-api` actions, checked inline at the top of the
  single handler ([kitchen-api/index.ts:38-48](supabase/functions/kitchen-api/index.ts:38)).
- **Webhook signer:** the two webhook handlers, checked inline
  ([stripe-webhook/index.ts:44](supabase/functions/stripe-webhook/index.ts:44),
  [square-webhook/index.ts:56](supabase/functions/square-webhook/index.ts:56)).

Every enforcement point is server-side. **No authorization decision is made in client
code** — `kitchen.js` optimistically renders state changes ([kitchen.js:224-242](kitchen.js:224))
but every tap is re-validated by `ALLOWED_FROM` on the server
([kitchen-api/index.ts:25-31](supabase/functions/kitchen-api/index.ts:25), enforced at
[:77](supabase/functions/kitchen-api/index.ts:77)), and a rejected transition returns 409
and forces a resync ([kitchen.js:238](kitchen.js:238)).

**Endpoints that return or mutate another user's data:**

| Endpoint | What it exposes/mutates | Ownership check? |
|---|---|---|
| `kitchen-api` `list` | **Every order's** `customer_name`, `customer_phone`, `notes`, items, and totals — all active orders plus 12 hours of completed/canceled ones | No per-record check by design (staff view). Gate is the single shared kitchen key. [kitchen-api/index.ts:59-63](supabase/functions/kitchen-api/index.ts:59) |
| `kitchen-api` `advance` | **Any order** by raw UUID, including `status: "canceled"` | **Resource is fetched and mutated by ID with no ownership check** — only a status-transition guard. Any kitchen-key holder can cancel any order, including one belonging to a customer who already paid: [kitchen-api/index.ts:73-79](supabase/functions/kitchen-api/index.ts:73) with `canceled: ["paid","making","ready"]` at [:30](supabase/functions/kitchen-api/index.ts:30) |
| `order-status` | One order's `customer_name`, items, totals, status | **Resource fetched by bearer token (`sid`), which IS the ownership proof.** Unguessable (UUIDv4), so this is acceptable in principle — but there is no rate limit and no expiry: [order-status/index.ts:19-23](supabase/functions/order-status/index.ts:19) |
| `notify-order` | Confirms existence of an arbitrary `order_id` (404 vs 200) and triggers an email about it | **Fetched by ID with no ownership check and no caller authentication whatsoever**: [notify-order/index.ts:35-40](supabase/functions/notify-order/index.ts:35) |
| `daily-summary` | Aggregate revenue and order count for the whole business, **returned in the HTTP response body** | **No authentication of any kind**: [daily-summary/index.ts:66](supabase/functions/daily-summary/index.ts:66) `return json({ ok: true, orders: fulfilled.length, revenue })` |
| `reconcile` | Order **codes** of recovered/expired orders in the response body | **No authentication**; 5-minute self-throttle only: [reconcile/index.ts:67](supabase/functions/reconcile/index.ts:67) |

**Flagged: resources fetched by ID without an ownership check** — `kitchen-api` `advance`
([:73](supabase/functions/kitchen-api/index.ts:73)) and `notify-order`
([:38](supabase/functions/notify-order/index.ts:38)). Both take a caller-supplied
identifier and act on whatever row it names.

## 7. Admin / back-office / kitchen surfaces

There is no admin panel, no CMS, and no owner dashboard. Staff order access is exactly one
surface:

- **`kitchen.html` — the KDS.** Served from the **same origin as the public customer site**
  (`https://zachachacker.github.io/lilys-mediterranean/kitchen.html`). It is a plain static
  page reachable by anyone who types the URL; the page itself renders a login prompt
  ([kitchen.js:260-283](kitchen.js:260)) but the HTML, the JS, and the embedded anon key are
  fully downloadable without any credential.
- **Authentication:** one shared static kitchen key, typed once per tablet, held in
  `localStorage` ([kitchen.js:273](kitchen.js:273)). Same-origin as the public site means
  **any XSS anywhere on the customer site reads the kitchen key and every customer's name,
  phone and address-free order history.**
- **Discoverability:** `<meta name="robots" content="noindex,nofollow">` is set
  ([kitchen.html:6](kitchen.html:6)) — but there is no `robots.txt`, no auth wall, and the
  path is guessable. `noindex` is an SEO courtesy, not access control. The whole page,
  including `kitchen.js` with its polling logic and API shape, is public source.
- **Refund access:** the KDS deep-links to the **Stripe dashboard** for refunds
  ([kitchen.js:488](kitchen.js:488)) — refunds happen entirely outside this system.
- **The `daily-summary` email** ([daily-summary/index.ts:42-50](supabase/functions/daily-summary/index.ts:42))
  is the only other back-office channel; it pushes revenue to `app_config.notify_email`.

---

# C. The money path

## 8. Price computation — **where the final charged amount is calculated**

**The final charged amount is computed server-side, in the Edge Function, from prices read
out of the database. No client-supplied price, quantity-price, tax, tip, or fee is ever
trusted.** This is the correct design and it is implemented correctly.

The client sends **only item ids and quantities** — no prices at all:

```js
// order.js:284-289
body: JSON.stringify({
  items: [...cart].map(([id, qty]) => ({ id, qty })),
  name, phone,
  notes: $("cfNotes").value.trim(),
}),
```
([order.js:284-289](order.js:284))

The server discards anything else, looks each id up in `menu_items`, and prices from the
DB row:

```ts
// create-checkout/index.ts:106-122
const { data: menu, error: menuErr } = await db
  .from("menu_items")
  .select("id,name,price_cents,orderable")
  .in("id", ids);
...
for (const l of items) {
  const m = byId.get(l.id);
  if (!m || !m.orderable) return json({ error: `Sorry — an item in your cart isn't available online.` }, 400);
  lines.push({ id: m.id, name: m.name, qty: l.qty, unit_cents: m.price_cents });
}

const subtotal = lines.reduce((s, l) => s + l.unit_cents * l.qty, 0);
const tax = Math.round(subtotal * taxRate);
const total = subtotal + tax;
```
([create-checkout/index.ts:106-122](supabase/functions/create-checkout/index.ts:106))

`unit_cents` comes from `m.price_cents` (the DB), never from `l`. The line-item payload
sent to Square ([:172-178](supabase/functions/create-checkout/index.ts:172)) and to Stripe
([:233-243](supabase/functions/create-checkout/index.ts:233)) is built from `lines`, so the
provider charges the server's number.

Client-controlled inputs and their server-side bounds:

| Input | Client value | Server enforcement |
|---|---|---|
| `qty` | any JSON value | must be an integer, 1–20 inclusive: [create-checkout/index.ts:60](supabase/functions/create-checkout/index.ts:60) |
| `id` | any string | must exist in `menu_items` **and** `orderable === true`: [:116](supabase/functions/create-checkout/index.ts:116) |
| line count | any array | ≤40, and duplicate ids rejected: [:58](supabase/functions/create-checkout/index.ts:58), [:65](supabase/functions/create-checkout/index.ts:65) |
| `name` / `phone` / `notes` | free text | trimmed and truncated to 80 / 25 / 500: [:50-52](supabase/functions/create-checkout/index.ts:50) |
| price, tax, subtotal, total | **not accepted at all** | — |

**Tax** is server-side, read from `app_config.tax_rate`, with a sanity bound that rejects a
corrupted config rather than charging a wrong rate:

```ts
const taxRate = Number(cfg.tax_rate ?? "0.07");
if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 0.2) { ... 503 }
```
([create-checkout/index.ts:94-98](supabase/functions/create-checkout/index.ts:94))

**There is no tip field, no delivery fee, and no shipping** — pickup only, and Square is
explicitly told not to ask for an address
([create-checkout/index.ts:182](supabase/functions/create-checkout/index.ts:182)).

**The material risk is not price tampering — it is the pricing *pipeline*.** Displayed
prices come from `data.js` with a 3% markup applied in the browser
([data.js:22-25](data.js:22), [order.js:24-27](order.js:24)), while charged prices come
from the `menu_items` table, populated by a **manually run script**
([scripts/sync-menu.mjs:1-4](scripts/sync-menu.mjs:1)). Nothing enforces that the two
agree. [supabase/functions/README.md:52-57](supabase/functions/README.md:52) warns "After
any menu edit, re-run the sync or the server will charge stale prices." A forgotten sync
silently charges a price different from the one the customer agreed to — a consumer-law
and chargeback problem, not a hacking one. There is no test, no CI check, and no runtime
assertion that closes this gap.

Related: [main.js:8-97](main.js:8) holds a *third* copy of the price list as a dead
fallback, which no sync script touches.

## 9. Cart & inventory model

- **Cart storage: `localStorage`, client-only**, key `lilys-cart-v1`
  ([order.js:134](order.js:134), written [:142](order.js:142)). There is no server-side
  cart, no cart table, no cart id. The cart is a `Map<id, qty>` serialised as
  `[[id, qty], ...]`.
- **Cart rehydration is defensively validated** — a tampered `localStorage` blob cannot
  inject unknown items or non-integer quantities, and qty is clamped to 20:
  ```js
  saved.forEach(([id, qty]) => {
    if (byId.get(id)?.orderable && Number.isInteger(qty) && qty > 0) cart.set(id, Math.min(qty, 20));
  });
  ```
  ([order.js:138-140](order.js:138), repeated for bfcache restore at [:321-323](order.js:321)).
  This is client-side only, but since the server re-validates ([§8](#8-price-computation--where-the-final-charged-amount-is-calculated)) it is defence in depth, not the control.
- **Inventory: there is none.** No stock column, no quantity-on-hand, no decrement, no
  reservation. The only availability concept is the boolean `menu_items.orderable`
  ([create-checkout/index.ts:108](supabase/functions/create-checkout/index.ts:108)), which
  marks range-priced items (e.g. wings, `$12.99–$19.99`) as phone-order-only
  ([scripts/sync-menu.mjs:26-29](scripts/sync-menu.mjs:26)).
- **Availability IS re-checked at checkout** — `orderable` is verified server-side at
  [create-checkout/index.ts:116](supabase/functions/create-checkout/index.ts:116), not
  merely at render time. Nothing is decremented because nothing is counted.
- **Opening-hours check** is enforced server-side for real orders
  ([create-checkout/index.ts:102-104](supabase/functions/create-checkout/index.ts:102)) and
  mirrored client-side for UX ([order.js:117-120](order.js:117)). **Demo orders are
  deliberately exempt** ([:101-102](supabase/functions/create-checkout/index.ts:101)) — see
  §13 for why that matters.

## 10. Promo codes, discounts, loyalty

**N/A — evidence:** no promo, coupon, discount, voucher, gift-card, or loyalty concept
exists anywhere in the codebase. Grep across all JS/TS/HTML for `promo`, `coupon`,
`discount`, `voucher`, `loyalty` returns no implementation. The cart form has exactly three
inputs — name, phone, notes ([order.html:78-91](order.html:78)) — and `create-checkout`
accepts exactly four body fields ([create-checkout/index.ts:43](supabase/functions/create-checkout/index.ts:43)).
The Stripe session is built without `discounts` or `allow_promotion_codes`
([create-checkout/index.ts:224-243](supabase/functions/create-checkout/index.ts:224)), and
the Square payload has no `discounts` array
([:166-185](supabase/functions/create-checkout/index.ts:166)).

Note that a **promotion could still be applied inside the Square or Stripe dashboard**
(e.g. an account-level coupon on the hosted checkout page), entirely outside this repo.
**UNVERIFIED** — resolve via the Square Dashboard → Discounts and Stripe Dashboard →
Coupons. If any exist, the redemption logic is the provider's, not ours.

The only price modifier in the system is the flat 3% online markup
([data.js:22-25](data.js:22)), applied at menu-sync time, not per-order.

## 11. Payment integration

| Aspect | Finding | Evidence |
|---|---|---|
| Providers | **Square (selected) and Stripe (wired, dormant)**, chosen by an `app_config.payment_provider` row | [create-checkout/index.ts:76-88](supabase/functions/create-checkout/index.ts:76); commit `ab6762a` |
| Integration type | **Hosted redirect for both.** Square Payment Links; Stripe Checkout Sessions | Square: `POST https://connect.squareup.com/v2/online-checkout/payment-links` [:189](supabase/functions/create-checkout/index.ts:189), customer sent to `link.payment_link.url` [:219](supabase/functions/create-checkout/index.ts:219). Stripe: `POST https://api.stripe.com/v1/checkout/sessions` [:247](supabase/functions/create-checkout/index.ts:247), redirect at [order.js:296](order.js:296) |
| Card data on our servers? | **Never.** No card field exists in any HTML form ([order.html:78-91](order.html:78) — name, tel, textarea only). No Stripe.js, no Square Web Payments SDK, no iframe, no tokenisation code anywhere. The browser leaves our origin entirely to pay |
| Card data in our DOM? | **Never** — same evidence. Zero payment-provider JavaScript is loaded on any page (grep for `stripe.js`/`squarecdn`/`web-payments` across all HTML returns nothing) |
| **PCI-DSS scope** | **SAQ A.** Both integrations are full-redirect hosted payment pages, all cardholder data entry occurs on the provider's PCI-validated page, and no CHD traverses or is stored by our systems. SAQ A is the correct and minimum scope. Note the caveat: SAQ A requires that the *redirecting page* is protected from tampering — the absence of any CSP and the fact that the site loads third-party fonts from `fonts.googleapis.com`/`fonts.gstatic.com` ([order.html:9-13](order.html:9)) are the relevant weaknesses to test |
| Idempotency | **Square: yes** — `idempotency_key: order.id`, a UUID, so one payment link per order forever ([create-checkout/index.ts:167](supabase/functions/create-checkout/index.ts:167)). **Stripe: no idempotency key is sent** on the session-create call ([:247-251](supabase/functions/create-checkout/index.ts:247)) — a retried request creates a second Checkout Session. Mitigated because each call also creates a fresh order row, so it is a duplicate-order risk rather than a double-charge risk |
| Session expiry | Stripe sessions expire after 1 hour ([:229](supabase/functions/create-checkout/index.ts:229)). Square payment links have **no expiry set** in the payload ([:166-185](supabase/functions/create-checkout/index.ts:166)) |
| Async payment methods | Deliberately disabled on Stripe — `payment_method_types[0]=card` only, with an explicit comment that ACH/BNPL would "complete" while unpaid ([:222-226](supabase/functions/create-checkout/index.ts:222)). **Square's payment link does not restrict methods**, so whatever the Square account enables (including Afterpay/Cash App) is accepted; the webhook compensates by requiring `status === "COMPLETED"` ([square-webhook/index.ts:74](supabase/functions/square-webhook/index.ts:74)) |
| Failure handling | Both paths cancel the order row and surface a call-us message rather than leaving a phantom order ([:202-206](supabase/functions/create-checkout/index.ts:202), [:254-258](supabase/functions/create-checkout/index.ts:254)); if the provider id can't be persisted, the Stripe session is proactively expired ([:262-269](supabase/functions/create-checkout/index.ts:262)) |
| Refunds | **Not implemented in this system at all.** Refunds are performed manually in the Stripe dashboard via a deep link ([kitchen.js:487-489](kitchen.js:487)) and the KDS explicitly warns that cancelling does not refund ([kitchen.js:493](kitchen.js:493)). **No Square refund link exists** — [kitchen.js:487](kitchen.js:487) gates on `o.stripe_payment_intent`, which is never populated on the Square path (Square writes `provider_payment_id` instead, [square-webhook/index.ts:86](supabase/functions/square-webhook/index.ts:86)). With Square live, staff get a cancel button and no refund path |

## 12. Webhooks

Two inbound webhook receivers. Both verify signatures; neither has replay protection
beyond what the signature scheme provides.

### `/stripe-webhook` — [supabase/functions/stripe-webhook/index.ts](supabase/functions/stripe-webhook/index.ts)

| Control | Status | Evidence |
|---|---|---|
| Signature verification | **Present and correct.** HMAC-SHA256 over `${t}.${payload}`, hex, constant-time compare, supports multiple `v1` values for secret rotation | [:18-29](supabase/functions/stripe-webhook/index.ts:18); `timingSafeEqual` at [:8-13](supabase/functions/stripe-webhook/index.ts:8) |
| Raw body used? | **Yes** — `await req.text()` before any parse, so the signed bytes are what's verified | [:42](supabase/functions/stripe-webhook/index.ts:42) |
| Replay protection | **Timestamp tolerance of 300s only** ([:24](supabase/functions/stripe-webhook/index.ts:24)). No event-id ledger. Within a 5-minute window a captured request can be replayed verbatim. **Impact is low** because every transition is `pending → X` and idempotent ([:58](supabase/functions/stripe-webhook/index.ts:58)) |
| Endpoint authenticated? | No JWT — `verify_jwt` documented OFF ([:1-3](supabase/functions/stripe-webhook/index.ts:1)). Signature is the sole auth. **UNVERIFIED that `verify_jwt=false` is actually set on the deployed function** — needs the Supabase dashboard |
| Trusts body over provider lookup? | **Yes.** It acts on `session.payment_status` and `session.id` straight from the event body, with no `GET /v1/checkout/sessions/{id}` confirmation ([:49-50](supabase/functions/stripe-webhook/index.ts:49), [:83](supabase/functions/stripe-webhook/index.ts:83)). This is standard Stripe practice and acceptable *given* a correct signature check. The compensating control is `reconcile`, which does re-query Stripe ([reconcile/index.ts:44-49](supabase/functions/reconcile/index.ts:44)) |
| Secret source | Env first, then `app_config.stripe_webhook_secret`; **refuses to run (503) if unset** — fails closed | [:35-40](supabase/functions/stripe-webhook/index.ts:35) |
| Error handling | Returns 500 on transient failure so Stripe redelivers; returns "ok" if the order is already in a terminal state | [:52-76](supabase/functions/stripe-webhook/index.ts:52), [:94](supabase/functions/stripe-webhook/index.ts:94) |
| **Defect** | `JSON.parse(payload)` at [:48](supabase/functions/stripe-webhook/index.ts:48) is **outside any try/catch**. A signature-valid request with a malformed body throws an unhandled exception → 500 → infinite Stripe retry loop. Reachable only by the secret holder, so low severity |

### `/square-webhook` — [supabase/functions/square-webhook/index.ts](supabase/functions/square-webhook/index.ts)

| Control | Status | Evidence |
|---|---|---|
| Signature verification | **Present and correct.** HMAC-SHA256 over `notificationUrl + rawBody`, base64, constant-time compare — matches Square's documented scheme | [:20-30](supabase/functions/square-webhook/index.ts:20), compared at [:56](supabase/functions/square-webhook/index.ts:56) |
| Raw body used? | **Yes** — `await req.text()` at [:35](supabase/functions/square-webhook/index.ts:35), parsed only after verification at [:66](supabase/functions/square-webhook/index.ts:66) |
| Fails closed? | **Yes, explicitly.** Missing signature key → 503 with a logged error, never a bypass ([:50-53](supabase/functions/square-webhook/index.ts:50)). Empty provided signature → 401 ([:56](supabase/functions/square-webhook/index.ts:56)) |
| Notification URL | Read from `app_config.square_webhook_url`, falling back to a derived URL ([:47-48](supabase/functions/square-webhook/index.ts:47)). **If the fallback doesn't byte-match the URL registered in Square, every legitimate webhook fails signature verification and orders silently never leave `pending`** — a config-drift availability trap called out in the runbook ([supabase/functions/README.md:42-43](supabase/functions/README.md:42)) |
| Replay protection | **None at all.** No timestamp check, no event-id ledger. A captured valid request replays forever. **Impact is contained** by the `pending → paid` guard ([:87](supabase/functions/square-webhook/index.ts:87)), which makes replay a no-op |
| Trusts body over provider lookup? | **Yes** — `payment.status`, `payment.order_id`, `payment.id` all taken from the body with no Square API confirmation ([:71-80](supabase/functions/square-webhook/index.ts:71)). **There is no Square equivalent of `reconcile`** — `reconcile` only speaks Stripe ([reconcile/index.ts:19-20](supabase/functions/reconcile/index.ts:19)), so on the Square path this trust has **no compensating control** |
| Endpoint authenticated? | No JWT — documented `verify_jwt` OFF ([:4-5](supabase/functions/square-webhook/index.ts:4)). **UNVERIFIED** on the deployed function |
| Idempotency | Correct — `.eq("status","pending")` means duplicate deliveries and cancelled-order resurrection are both impossible ([:87-88](supabase/functions/square-webhook/index.ts:87)) |
| Coverage gap | Only `payment.*` events with `status === "COMPLETED"` are handled ([:74](supabase/functions/square-webhook/index.ts:74)). **`refund.created` / `refund.updated` are not handled**, so a refund issued in Square leaves the order looking paid in our database forever |

## 13. Order state machine

Statuses, from the code: **`pending`, `paid`, `making`, `ready`, `done`, `canceled`** — six
total. Derived from the transition map ([kitchen-api/index.ts:25-31](supabase/functions/kitchen-api/index.ts:25)),
the confirmation-page step list ([order.js:39-43](order.js:39)), and the creation call
([create-checkout/index.ts:131](supabase/functions/create-checkout/index.ts:131)).
**UNVERIFIED** whether the DB column is a Postgres enum or free text with a CHECK
constraint — no migration exists in the repo.

| Transition | Trigger | Who can trigger | Server-side guard | Evidence |
|---|---|---|---|---|
| `∅ → pending` | Order created, real provider | Anyone (public endpoint) | Hours check, cart validation | [create-checkout/index.ts:131](supabase/functions/create-checkout/index.ts:131) |
| `∅ → paid` | Order created, **demo mode** | Anyone (public endpoint) | **Hours check deliberately skipped** | [:101-104](supabase/functions/create-checkout/index.ts:101), [:131](supabase/functions/create-checkout/index.ts:131) |
| `pending → paid` | Stripe `checkout.session.completed` (with `payment_status==="paid"`) or `async_payment_succeeded` | Stripe (signature) | `.eq("status","pending")` | [stripe-webhook/index.ts:58](supabase/functions/stripe-webhook/index.ts:58), [:80-85](supabase/functions/stripe-webhook/index.ts:80) |
| `pending → paid` | Square `payment.*` with `COMPLETED` | Square (signature) | `.eq("status","pending")` | [square-webhook/index.ts:84-88](supabase/functions/square-webhook/index.ts:84) |
| `pending → paid` | Reconciliation sweep confirms with Stripe | `pg_cron`, **or any unauthenticated caller** | `.eq("status","pending")` + live Stripe lookup | [reconcile/index.ts:50-55](supabase/functions/reconcile/index.ts:50) |
| `pending → canceled` | Stripe `checkout.session.expired` / `async_payment_failed` | Stripe (signature) | `.eq("status","pending")` | [stripe-webhook/index.ts:86-91](supabase/functions/stripe-webhook/index.ts:86) |
| `pending → canceled` | Reconciliation finds an expired session | `pg_cron` / unauthenticated | `.eq("status","pending")` | [reconcile/index.ts:60-62](supabase/functions/reconcile/index.ts:60) |
| `pending → canceled` | Provider API call failed during creation | The function itself | — | [create-checkout/index.ts:203](supabase/functions/create-checkout/index.ts:203), [:216](supabase/functions/create-checkout/index.ts:216), [:255](supabase/functions/create-checkout/index.ts:255), [:268](supabase/functions/create-checkout/index.ts:268) |
| `paid → making` | Cook taps a New ticket | Kitchen key | target `making` accepts from `["paid","ready","done"]` | [kitchen-api/index.ts:27](supabase/functions/kitchen-api/index.ts:27), [kitchen.js:455](kitchen.js:455) |
| `making → ready` | Cook taps READY | Kitchen key | target `ready` accepts from `["making","done"]` | [kitchen-api/index.ts:28](supabase/functions/kitchen-api/index.ts:28), [kitchen.js:461](kitchen.js:461) |
| `ready → done` | Cook taps PICKED UP | Kitchen key | target `done` accepts from `["ready"]` only | [kitchen-api/index.ts:29](supabase/functions/kitchen-api/index.ts:29), [kitchen.js:467](kitchen.js:467) |
| `making → paid` | Undo "start making" | Kitchen key | target `paid` accepts from `["making"]` only | [kitchen-api/index.ts:26](supabase/functions/kitchen-api/index.ts:26) |
| `ready → making` | Undo "ready" | Kitchen key | via target `making` | [kitchen-api/index.ts:27](supabase/functions/kitchen-api/index.ts:27) |
| `done → making` | **Recall** a bumped ticket (UI limits to 1h; **server does not**) | Kitchen key | via target `making` — **no time bound server-side** | [kitchen-api/index.ts:27](supabase/functions/kitchen-api/index.ts:27), UI window [kitchen.js:21](kitchen.js:21), [:430](kitchen.js:430) |
| `done → ready` | Undo "picked up" | Kitchen key | via target `ready` | [kitchen-api/index.ts:28](supabase/functions/kitchen-api/index.ts:28) |
| **`paid`/`making`/`ready` → `canceled`** | `···` menu → Cancel this order | Kitchen key | guarded — **but no refund, no reason, no actor recorded** | [kitchen-api/index.ts:30](supabase/functions/kitchen-api/index.ts:30), [kitchen.js:501-504](kitchen.js:501) |

**Observations for the test plan:**

1. **`canceled` is terminal — verified.** In `ALLOWED_FROM`
   ([kitchen-api/index.ts:25-31](supabase/functions/kitchen-api/index.ts:25)) the **key is
   the target status and the array is the set of permitted current statuses**
   (`const from = ALLOWED_FROM[to]` → `.in("status", from)` at
   [:71](supabase/functions/kitchen-api/index.ts:71), [:77](supabase/functions/kitchen-api/index.ts:77)).
   No array in that map contains `"canceled"`, so no transition can move an order *out* of
   `canceled`. A cancelled order cannot be resurrected by the KDS. Correct as built. Note
   the corollary though: `done` is **not** terminal — target `making`
   ([:27](supabase/functions/kitchen-api/index.ts:27)) accepts `done`, with **no server-side
   time limit**, so any completed order from any date can be pulled back onto the board.
   The 1-hour recall window is UI-only ([kitchen.js:21](kitchen.js:21), [:430](kitchen.js:430)).
2. **Cancel ≠ refund.** Cancelling a paid order moves the row to `canceled` and takes no
   money back ([kitchen.js:493](kitchen.js:493) warns staff explicitly). On the Square path
   there isn't even a refund deep link (§11).
3. **There is no `refunded` status.** A refund performed in the provider dashboard is
   invisible to this system.
4. **No re-order path exists.** No "order again" endpoint or UI.
5. **No customer-initiated cancel exists.** Customers cannot cancel; only staff can.
6. **Every transition is guarded server-side** by `.in("status", from)` with a 409 on
   mismatch ([kitchen-api/index.ts:77-81](supabase/functions/kitchen-api/index.ts:77)) —
   this part is genuinely well built.
7. **The `∅ → paid` demo transition is the dangerous one** — see Top-10 #1.

---

# D. Data

## 14. Data model & PII inventory

No migrations or schema files exist in the repo (`find . -name '*.sql'` outside the archive
returns nothing). The schema below is **reconstructed from query usage** and is therefore
column-accurate but constraint-blind.

**Tables (3):**

- **`public.menu_items`** — `id` (text slug, PK, `on conflict (id)`), `name`, `description`,
  `category`, `price_cents` (int), `tag`, `orderable` (bool).
  Evidence: [scripts/sync-menu.mjs:38-47](scripts/sync-menu.mjs:38),
  [create-checkout/index.ts:108](supabase/functions/create-checkout/index.ts:108).
- **`public.orders`** — `id` (uuid PK), `code` (text, unique — a duplicate error is caught
  at [create-checkout/index.ts:149](supabase/functions/create-checkout/index.ts:149)),
  `status`, `customer_name`, `customer_phone`, `notes`, `items` (JSON array),
  `subtotal_cents`, `tax_cents`, `total_cents`, `demo` (bool), `payment_provider`,
  `stripe_session_id`, `stripe_payment_intent`, `provider_order_id`, `provider_payment_id`,
  `notified_at`, `created_at`, `updated_at`.
  Evidence: [create-checkout/index.ts:129-145](supabase/functions/create-checkout/index.ts:129),
  [kitchen-api/index.ts:61](supabase/functions/kitchen-api/index.ts:61),
  [square-webhook/index.ts:86](supabase/functions/square-webhook/index.ts:86),
  [notify-order/index.ts:37](supabase/functions/notify-order/index.ts:37).
- **`public.app_config`** — `key` (text PK, `upsert` at
  [reconcile/index.ts:25](supabase/functions/reconcile/index.ts:25)), `value` (text).
  **This table stores live payment secrets in plaintext** — see §19.

**Database objects referenced but not present in the repo:** triggers
`orders_notify_insert` / `orders_notify_update`, and `pg_cron` jobs `reconcile-orders` and
the 08:30 daily summary ([supabase/functions/README.md:18-24](supabase/functions/README.md:18),
[daily-summary/index.ts:2](supabase/functions/daily-summary/index.ts:2)). **UNVERIFIED** —
requires `list_migrations` or a `pg_dump` of the schema.

**PII inventory (UK GDPR relevance noted below):**

| Field | Table | Category | Collected at | Retention | Encrypted at rest? |
|---|---|---|---|---|---|
| `customer_name` | `orders` | Identifying (name) | [order.html:80](order.html:80) → [create-checkout/index.ts:50](supabase/functions/create-checkout/index.ts:50) | **No policy — indefinite.** Nothing in the codebase deletes an order | Supabase/AWS volume-level AES-256 only. **No column encryption.** UNVERIFIED at project level |
| `customer_phone` | `orders` | Identifying (phone) | [order.html:83](order.html:83) → [:51](supabase/functions/create-checkout/index.ts:51) | Indefinite | Same |
| `notes` | `orders` | **Free text — high risk.** Prompt is dietary/prep ("No onions, extra garlic sauce…", [order.html:86](order.html:86)), so **allergy and health data (GDPR Art. 9 special category) will land here** | [:52](supabase/functions/create-checkout/index.ts:52) | Indefinite | Same |
| `items` | `orders` | Behavioural (dietary inference — halal/vegan/kosher choices are religious/belief-adjacent) | [:135](supabase/functions/create-checkout/index.ts:135) | Indefinite | Same |
| `total_cents` etc. | `orders` | Financial (transaction value, not instrument) | [:136-138](supabase/functions/create-checkout/index.ts:136) | Indefinite | Same |
| `stripe_payment_intent`, `provider_payment_id`, `provider_order_id`, `stripe_session_id` | `orders` | **Payment metadata — pointers only, no PAN, no CVV, no expiry** | [:144](supabase/functions/create-checkout/index.ts:144), [:261](supabase/functions/create-checkout/index.ts:261), [square-webhook/index.ts:86](supabase/functions/square-webhook/index.ts:86) | Indefinite | Same |
| Customer name + phone + items + notes | **Resend (email)** | All of the above, exported to a third-country processor | [notify-order/index.ts:52-54](supabase/functions/notify-order/index.ts:52) | Held in Resend's logs — outside our control | Resend's terms |
| Buyer phone | **Square** | Pre-populated into the hosted checkout | [create-checkout/index.ts:184](supabase/functions/create-checkout/index.ts:184) | Square's retention | Square's |
| IP address / geolocation | **Not collected by us.** No IP is read or stored in any function. Supabase and GitHub Pages will log IPs at the platform layer | — | Platform default | Platform |
| Cookies / device id | **None.** No cookies, no fingerprinting, no analytics (§18) | — | — | — |

**GDPR posture:** the restaurant is in **Indialantic, Florida, USA**
([data.js:33](data.js:33)) and serves US walk-in/pickup customers, so **UK/EU GDPR is
unlikely to apply on a territorial-scope basis** (no offering of goods to EU/UK data
subjects). US state law (notably the Florida Digital Bill of Rights) and **PCI-DSS SAQ A**
are the live regimes. That said, the following are absent regardless of jurisdiction and
should be in the test plan: **no privacy policy page** (the old site had
`terms-and-policies` — [old-site-archive/pages/terms-and-policies.html](old-site-archive/pages/terms-and-policies.html) —
the new site has **no equivalent**; grep of all 5 HTML files finds no privacy or terms
link), **no consent capture**, **no retention limit**, **no deletion mechanism**, and **no
data-subject-access path**.

## 15. Database access layer

- **ORM: none.** All access is via `@supabase/supabase-js` PostgREST client methods
  (`.from().select().eq()`, `.insert()`, `.update()`, `.upsert()`), instantiated identically
  in all 8 functions, e.g. [create-checkout/index.ts:67](supabase/functions/create-checkout/index.ts:67).
- **Raw SQL: exactly one location, build-time only.** [scripts/sync-menu.mjs:31-52](scripts/sync-menu.mjs:31)
  builds an `INSERT … ON CONFLICT` statement by string concatenation. It escapes single
  quotes ([:17](scripts/sync-menu.mjs:17) `esc = (s) => String(s).replace(/'/g, "''")`), the
  input is a developer-authored file (`data.js`), and the output is SQL a human reviews and
  pastes. **Not an injection surface from the internet**, but it is raw string-built SQL and
  belongs in the inventory. Related: [scripts/sync-menu.mjs:13](scripts/sync-menu.mjs:13)
  executes `data.js` through `new Function(...)` — arbitrary code execution by design,
  scoped to a trusted local file.
- **Every instance of string interpolation into a query filter** (this is the complete list
  — I grepped every `.or(`, `.in(`, `.filter(`, `.eq(` call in all 8 functions):

  | Location | Interpolated value | Source | Assessment |
  |---|---|---|---|
  | [stripe-webhook/index.ts:59](supabase/functions/stripe-webhook/index.ts:59) | `` `stripe_session_id.eq.${session.id},id.eq.${orderId}` `` | **Webhook request body** (`event.data.object.id` and `.metadata.order_id`) | **PostgREST filter injection primitive.** `.or()` takes a filter-DSL string; commas and dots are structural. A body containing e.g. `id.eq.x,status.eq.paid` alters the WHERE clause. Gated behind the HMAC check, so it is only reachable by whoever holds `stripe_webhook_secret` — but it converts "webhook secret leaked" from a nuisance into arbitrary row targeting |
  | [stripe-webhook/index.ts:70](supabase/functions/stripe-webhook/index.ts:70) | same two values | same | Same issue, in the existence-check query |
  | [kitchen-api/index.ts:62](supabase/functions/kitchen-api/index.ts:62) | `` `…created_at.gte.${twelveHoursAgo}` `` | Server-generated ISO timestamp ([:58](supabase/functions/kitchen-api/index.ts:58)) | **Not attacker-controlled.** Safe as written |
  | [reconcile/index.ts:44](supabase/functions/reconcile/index.ts:44) | `` `…/checkout/sessions/${o.stripe_session_id}` `` | DB column, originally from Stripe or our own UUID | URL-path interpolation, not SQL. Value is server-minted or Stripe-minted; low risk, but unescaped into a URL |

  All other query parameters are passed as **arguments** to `.eq()` / `.in()` and are
  properly encoded by the client — e.g. [order-status/index.ts:22](supabase/functions/order-status/index.ts:22)
  `.eq("stripe_session_id", sid)` is safe even though `sid` is fully attacker-controlled.

- **Connection pooling:** none managed by us. Each Edge Function invocation constructs a new
  `createClient` over PostgREST/HTTP — no direct Postgres connection, no pool, no
  `pgbouncer` config in this repo.
- **DB user privilege: over-privileged, and this is the central design risk.** All 8
  functions authenticate with `SUPABASE_SERVICE_ROLE_KEY`
  ([create-checkout/index.ts:67](supabase/functions/create-checkout/index.ts:67),
  [order-status/index.ts:18](supabase/functions/order-status/index.ts:18),
  [kitchen-api/index.ts:37](supabase/functions/kitchen-api/index.ts:37),
  [stripe-webhook/index.ts:34](supabase/functions/stripe-webhook/index.ts:34),
  [square-webhook/index.ts:36](supabase/functions/square-webhook/index.ts:36),
  [notify-order/index.ts:26](supabase/functions/notify-order/index.ts:26),
  [reconcile/index.ts:14](supabase/functions/reconcile/index.ts:14),
  [daily-summary/index.ts:16](supabase/functions/daily-summary/index.ts:16)). The service
  role **bypasses Row Level Security entirely** and can read and write every table
  including `app_config` (which holds the live payment secrets). There is no read-only
  client, no least-privilege role, and no separation between the public
  `order-status` endpoint and the secret-bearing `create-checkout`. **Any logic flaw in any
  one of these functions is a full-database flaw.** In particular `order-status` — a
  completely public GET endpoint — holds a service-role handle.
- **RLS status: UNVERIFIED and critical.** No migration, no policy file, and no
  `config.toml` exists in the repo, so nothing here states whether `orders` and `app_config`
  have RLS enabled. What *is* proven is that PostgREST is publicly reachable with the anon
  key and that `menu_items` is anon-readable
  ([.claude/settings.local.json:12](.claude/settings.local.json:12) shows a successful
  `GET /rest/v1/menu_items?select=id&limit=1`). **If `orders` lacks RLS, one anonymous
  request to `/rest/v1/orders?select=*` dumps every customer's name, phone and notes; if
  `app_config` lacks RLS, the same request pattern yields the Square access token, the
  webhook signature key, the Resend key and the kitchen key.** Resolve with
  `list_tables` (which reports `rls_enabled`) or `select * from pg_policies` — see Blocking
  Unknowns.

## 16. Input validation

- **No central validation layer.** No Zod, Joi, Yup, Valibot, ajv, or any schema library
  anywhere — there is no dependency manifest at all to hold one (§1). Validation is **ad
  hoc and inline**, hand-written per handler.
- The one well-validated endpoint is `create-checkout`
  ([:50-65](supabase/functions/create-checkout/index.ts:50)) — type checks, integer checks,
  range checks, length truncation, duplicate rejection. It is thorough for the fields it
  covers.

**Endpoints with no or near-no input validation:**

| Endpoint | Gap |
|---|---|
| `/daily-summary` | Body is never read. Any POST executes the full job | [daily-summary/index.ts:13-16](supabase/functions/daily-summary/index.ts:13) |
| `/reconcile` | Body is never read | [reconcile/index.ts:11-14](supabase/functions/reconcile/index.ts:11) |
| `/stripe-webhook` | Post-signature, the event is `JSON.parse`d and field-accessed with **no schema check and no try/catch** | [:48-50](supabase/functions/stripe-webhook/index.ts:48) |
| `/square-webhook` | Post-signature, only `type` prefix and `payment.status` are checked; `order_id` and `id` are used unvalidated | [:71-88](supabase/functions/square-webhook/index.ts:71) |
| `/order-status` | Only "present and ≤200 chars" — no format check on `sid` | [:16](supabase/functions/order-status/index.ts:16) |
| `/notify-order` | Only "non-empty string" on `order_id` — no UUID format check | [:23-24](supabase/functions/notify-order/index.ts:23) |
| `/kitchen-api` | `id` is `String(body.id ?? "")` with no UUID validation; `to` is key-checked | [:69-72](supabase/functions/kitchen-api/index.ts:69) |

**Output encoding / XSS:**

- There is **no templating engine and no framework auto-escaping** — every surface is
  hand-built HTML strings assigned to `innerHTML`. That makes escaping a per-call-site
  discipline, and the discipline is mostly, but not entirely, held.
- **Escaping helpers, all hand-rolled:** [order.js:18](order.js:18) (`&`, `<`, `>`),
  [chat.js:14](chat.js:14) (same three), [kitchen.js:41](kitchen.js:41) (five chars —
  adds `"` and `'`), [notify-order/index.ts:11](supabase/functions/notify-order/index.ts:11)
  and [daily-summary/index.ts:10](supabase/functions/daily-summary/index.ts:10) (three).
  **The three-character variants do not escape quotes**, so any of those values placed into
  an unquoted or single-quoted HTML *attribute* would break out. Audit of actual call sites:
  `order.js` and `chat.js` use `esc()` only in text positions, so this is currently latent,
  not exploitable.
- **`dangerouslySetInnerHTML` / `v-html`: N/A** — no React or Vue in the project.
- **`eval`: none.** One `new Function` at [scripts/sync-menu.mjs:13](scripts/sync-menu.mjs:13),
  build-time, on a trusted local file.
- **`innerHTML` / `outerHTML` / `insertAdjacentHTML` sinks — complete list (23):**
  [chat.js:183](chat.js:183), [:219](chat.js:219), [:226](chat.js:226), [:243](chat.js:243);
  [order.js:34](order.js:34), [:55](order.js:55), [:91](order.js:91), [:179](order.js:179),
  [:206](order.js:206), [:217](order.js:217), [:301](order.js:301), [:317](order.js:317);
  [main.js:165](main.js:165), [:298](main.js:298), [:304](main.js:304);
  [kitchen.js:262](kitchen.js:262), [:278](kitchen.js:278), [:390](kitchen.js:390),
  [:391](kitchen.js:391), [:407](kitchen.js:407), [:421](kitchen.js:421), [:490](kitchen.js:490),
  [:539](kitchen.js:539).
- **Sinks reached by attacker-influenced data, assessed individually:**
  - **[kitchen.js:299-311](kitchen.js:299) — the KDS ticket.** Renders `customer_name`,
    `customer_phone`, `notes`, and item `name` — **all originating from the public
    `create-checkout` endpoint**. Every one is wrapped in `esc()` (5-char), and the phone
    also passes `telHref()` which strips to `[^+\d]`
    ([kitchen.js:42](kitchen.js:42)). **Correctly escaped as written** — but this is the
    highest-value XSS target in the system (it executes in a session holding the kitchen
    key), so it deserves adversarial testing rather than a code-reading pass.
  - **[order.js:46](order.js:46) and [:55-72](order.js:55) — the confirmation page.**
    Renders `l.name`, `o.code`, `o.customer_name` from the API. `esc()`-wrapped throughout.
    Note `l.qty` at [:46](order.js:46) is interpolated **without** `esc()` — it is a
    server-validated integer ([create-checkout/index.ts:60](supabase/functions/create-checkout/index.ts:60))
    so it is safe today, but it is an unescaped interpolation of a DB value.
  - **[main.js:163](main.js:163) — the menu row.** `${n}` (name) and `${d}` (description)
    are interpolated **with no escaping at all**. Source is `data.js`, a developer-authored
    file, so it is not currently exploitable. It is a live stored-XSS sink the moment menu
    copy comes from the database or a CMS — and note [order.js:172-174](order.js:172) does
    escape the same fields, so the two renderers disagree.
  - **[notify-order/index.ts:47-56](supabase/functions/notify-order/index.ts:47) and
    [daily-summary/index.ts:39](supabase/functions/daily-summary/index.ts:39) — outbound
    email HTML.** Customer name, phone, notes and item names are `esc()`'d (3-char variant)
    into an HTML email. `l.qty` at [notify-order:47](supabase/functions/notify-order/index.ts:47)
    is unescaped. Target is the owner's inbox; modern mail clients strip script, so the
    realistic ceiling is layout/phishing injection.
- **No Content-Security-Policy exists on any page**, and GitHub Pages cannot serve response
  headers — so there is no mitigating control behind any of the above. Confirmed: grep for
  `Content-Security-Policy` and `http-equiv` across all 5 HTML files returns zero matches.

---

# E. Periphery

## 17. File uploads & media

**N/A — evidence:** there are no upload endpoints, no `multipart/form-data` handling, no
Supabase Storage usage, and no `<input type="file">` anywhere. Grep for `<input` across all
HTML returns exactly three fields, all in the order form
([order.html:80](order.html:80), [:83](order.html:83), [:86](order.html:86)), plus the
kitchen key field rendered at [kitchen.js:266](kitchen.js:266). No function reads a file or
a blob.

Media is **static and developer-committed**: ~120 images under `assets/photos/` and
`assets/photos/thumbs/`, referenced by a hardcoded name→filename map
([main.js:103-131](main.js:103)) and served from the app origin by GitHub Pages. Filenames
are developer-authored slugs; the only runtime filename manipulation is
`ph.replace(/\.png$/, ".webp")` ([main.js:161](main.js:161), [order.js:165](order.js:165)),
operating on values from that hardcoded map — **not user-influenced**, so no path traversal
surface.

## 18. Third-party integrations & outbound calls

| Service | Direction | What is sent | Where |
|---|---|---|---|
| **Square** | Server → `https://connect.squareup.com/v2/online-checkout/payment-links` | Order line items with names and prices, order code, location id, **customer phone number** (`pre_populated_data.buyer_phone_number`), redirect URL, Bearer access token | [create-checkout/index.ts:184](supabase/functions/create-checkout/index.ts:184), [:189-197](supabase/functions/create-checkout/index.ts:189) |
| **Stripe** | Server → `https://api.stripe.com/v1/checkout/sessions` | Line items, amounts, order id + code in metadata, success/cancel URLs, Bearer secret key | [create-checkout/index.ts:247-251](supabase/functions/create-checkout/index.ts:247) |
| **Stripe** | Server → `.../checkout/sessions/{id}` (GET) and `/expire` (POST) | Session id | [reconcile/index.ts:44](supabase/functions/reconcile/index.ts:44), [create-checkout/index.ts:264](supabase/functions/create-checkout/index.ts:264) |
| **Resend** | Server → `https://api.resend.com/emails` | **Customer name, phone, order notes, item names, totals** (per-order); revenue aggregates (daily) | [notify-order/index.ts:58-67](supabase/functions/notify-order/index.ts:58), [daily-summary/index.ts:52-61](supabase/functions/daily-summary/index.ts:52) |
| **Supabase** | Client → `hytvfqydahwsrcdbnvfq.supabase.co` | Cart contents, name, phone, notes | [data.js:49](data.js:49), [order.js:281](order.js:281) |
| **Google Fonts** | Browser → `fonts.googleapis.com` + `fonts.gstatic.com` | Visitor IP, User-Agent, Referer — on **every page including the KDS and the confirmation page** | [index.html:9-13](index.html:9), [order.html:9-13](order.html:9), [menu.html:9-13](menu.html:9), [kitchen.html:12-14](kitchen.html:12), [order-confirmed.html:8-10](order-confirmed.html:8) |
| **Delivery partners / Google Maps / Instagram** | Browser → outbound links only, all `rel="noopener"` | Nothing but the click | [data.js:39-45](data.js:39), [index.html:249-251](index.html:249) |
| **Analytics / telemetry** | **None.** No Google Analytics, GTM, Sentry, Hotjar, Plausible, or ElevenLabs — grep across all HTML and JS returns zero matches | — |
| **POS (SkyTab)** | **Not integrated.** No code references it; per project notes the POS stays decoupled | — |

**SSRF surface: minimal but non-zero.** No function fetches a URL supplied in a request
body. The four outbound hosts are hardcoded string literals
([create-checkout/index.ts:189](supabase/functions/create-checkout/index.ts:189),
[:247](supabase/functions/create-checkout/index.ts:247),
[reconcile/index.ts:44](supabase/functions/reconcile/index.ts:44),
[notify-order/index.ts:58](supabase/functions/notify-order/index.ts:58)). Two values are
interpolated into hardcoded hosts — `o.stripe_session_id` into a Stripe path
([reconcile/index.ts:44](supabase/functions/reconcile/index.ts:44)) and `session.id` into
the expire path ([create-checkout/index.ts:264](supabase/functions/create-checkout/index.ts:264)) —
both server- or Stripe-minted, unescaped, and confined to `api.stripe.com`. **The real
config-injection surface is `app_config`:** `site_url`
([create-checkout/index.ts:99](supabase/functions/create-checkout/index.ts:99)) becomes the
customer's post-payment redirect, `square_webhook_url`
([square-webhook/index.ts:47](supabase/functions/square-webhook/index.ts:47)) becomes the
signature base string, and `notify_from` / `notify_email`
([notify-order/index.ts:62-63](supabase/functions/notify-order/index.ts:62)) become mail
routing. **Anyone who can write a row to `app_config` can redirect every paying customer to
an arbitrary domain** — which makes the RLS question in §15 an open-redirect/phishing
question as well as a data-breach one.

## 19. Secrets & configuration

**No `.env` file exists, and none ever has.** `find . -name '.env*'` returns nothing, and
`git log --all -- '.env*'` returns no commits. There is no `.env.example` either.

**Environment variables consumed (complete list, all in Edge Functions):**

| Variable | Read at | Notes |
|---|---|---|
| `SUPABASE_URL` | [create-checkout:67](supabase/functions/create-checkout/index.ts:67), [order-status:18](supabase/functions/order-status/index.ts:18), [kitchen-api:37](supabase/functions/kitchen-api/index.ts:37), [stripe-webhook:34](supabase/functions/stripe-webhook/index.ts:34), [square-webhook:36](supabase/functions/square-webhook/index.ts:36) + [:48](supabase/functions/square-webhook/index.ts:48), [notify-order:26](supabase/functions/notify-order/index.ts:26), [reconcile:14](supabase/functions/reconcile/index.ts:14), [daily-summary:16](supabase/functions/daily-summary/index.ts:16) | Platform-injected, not secret |
| `SUPABASE_SERVICE_ROLE_KEY` | same 8 locations | **Highest-privilege secret in the system.** Platform-injected. Value never appears in the repo — verified |
| `STRIPE_SECRET_KEY` | [create-checkout:78](supabase/functions/create-checkout/index.ts:78), [reconcile:19](supabase/functions/reconcile/index.ts:19) | Falls back to `app_config.stripe_secret_key` |
| `STRIPE_WEBHOOK_SECRET` | [stripe-webhook:35](supabase/functions/stripe-webhook/index.ts:35) | Falls back to `app_config.stripe_webhook_secret` |
| `SQUARE_ACCESS_TOKEN` | [create-checkout:79](supabase/functions/create-checkout/index.ts:79) | Falls back to `app_config.square_access_token` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | [square-webhook:44](supabase/functions/square-webhook/index.ts:44) | Falls back to `app_config.square_webhook_signature_key` |

**Secrets stored in the database (`app_config`) rather than the secret manager** — this is
the notable configuration decision. Every one of these is a plaintext text column
reachable by any service-role query, and by anonymous PostgREST if RLS is not enabled:

| `app_config` key | Sensitivity | Read at |
|---|---|---|
| `square_access_token` | **Live payment credential** | [create-checkout:79](supabase/functions/create-checkout/index.ts:79) |
| `square_webhook_signature_key` | **Webhook forgery key** | [square-webhook:44](supabase/functions/square-webhook/index.ts:44) |
| `stripe_secret_key` | **Live payment credential** | [create-checkout:78](supabase/functions/create-checkout/index.ts:78), [reconcile:19](supabase/functions/reconcile/index.ts:19) |
| `stripe_webhook_secret` | **Webhook forgery key** | [stripe-webhook:37](supabase/functions/stripe-webhook/index.ts:37) |
| `kitchen_key` | **Full staff auth to all order PII** | [kitchen-api:38](supabase/functions/kitchen-api/index.ts:38) |
| `resend_api_key` | Email-send credential | [notify-order:31](supabase/functions/notify-order/index.ts:31), [daily-summary:20](supabase/functions/daily-summary/index.ts:20) |
| `square_location_id`, `square_api_version`, `square_webhook_url`, `payment_provider`, `tax_rate`, `site_url`, `notify_email`, `notify_from`, `reconcile_last_run` | Config — but `site_url` and `square_webhook_url` are security-relevant (§18) | various |

**Crucially, `create-checkout` reads the ENTIRE config table into memory on every request** —
`db.from("app_config").select("key,value")`
([create-checkout/index.ts:70](supabase/functions/create-checkout/index.ts:70); identical
pattern at [square-webhook:38](supabase/functions/square-webhook/index.ts:38),
[notify-order:28](supabase/functions/notify-order/index.ts:28),
[reconcile:16](supabase/functions/reconcile/index.ts:16),
[daily-summary:17](supabase/functions/daily-summary/index.ts:17)). Every live payment
secret is resident in the memory of a **publicly callable** function on every order. Only
`stripe-webhook` scopes its read to a single key
([:37](supabase/functions/stripe-webhook/index.ts:37)). Any information-disclosure bug in
`create-checkout` — an error path that serialises `cfg`, a future debug log — leaks the
payment credentials directly.

**Secrets in git: none found.** A full scan of every blob in every reachable commit
(`git rev-list --all --objects` → `git cat-file blob` → grep for `sk_live_`, `sk_test_`,
`whsec_`, `re_…`, `EAAA…`, `service_role`) produced **only redacted placeholders in
documentation** — [supabase/functions/README.md:81-82](supabase/functions/README.md:81) and
[:84](supabase/functions/README.md:84) contain literal `sk_live_…` / `whsec_…` ellipses, not
values. **No live secret has ever been committed.** The runbook also carries an explicit
handling instruction ([supabase/functions/README.md:49-50](supabase/functions/README.md:49)).

**Keys shipped to the client bundle:**

- The **Supabase anon key** is committed and served publicly, **twice**:
  [data.js:50](data.js:50) and, duplicated, [kitchen.js:15](kitchen.js:15). Value
  **[REDACTED]**. It **is** in git history (present since the ordering system landed in
  `019bc72`). This is intended and correct for Supabase's model — the decoded claims are
  `role: anon`, project ref `hytvfqydahwsrcdbnvfq`, `iat` 2026-07-16, `exp` 2036-07-16.
  **It carries no server-level privilege by itself**; its power is entirely determined by
  the RLS policies, which are unverified (§15). The 10-year lifetime and the fact that
  rotating it means editing two source files and redeploying are both worth noting.
- **No other key reaches the client.** No Stripe publishable key, no Square application id,
  no Resend key, no maps key.
- The **kitchen key** is not shipped in the bundle — it is typed by staff
  ([kitchen.js:271](kitchen.js:271)) — but it then lives in `localStorage` in clear text on
  a device that browses the public web.
- **Note:** [.claude/settings.local.json:8-13](.claude/settings.local.json:8) embeds the
  anon key inside allow-listed `curl` commands. That directory is **gitignored**
  ([.gitignore:2](.gitignore:2)) and never deployed, and the key is public anyway — so this
  is not a leak, but it is a local file containing a credential-shaped string.

## 20. Dependencies

**Direct dependencies — the complete list:**

| Dependency | Version specifier | Where | Assessment |
|---|---|---|---|
| `@supabase/supabase-js` | **`jsr:@supabase/supabase-js@2`** — floating major | All 8 functions, e.g. [create-checkout/index.ts:5](supabase/functions/create-checkout/index.ts:5) | **Unpinned.** Any 2.x release is resolved at deploy/cold-start. No lockfile means the deployed code can change without a commit — a supply-chain and reproducibility hole. Not known-vulnerable; simply uncontrolled |
| Deno standard runtime (`Deno.serve`, `crypto.subtle`, `fetch`, `Intl`) | Platform-provided | all functions | Supabase-managed; version **UNVERIFIED** |
| Node built-ins (`node:fs`, `node:url`, `node:path`) | Platform-provided | [scripts/sync-menu.mjs:5-7](scripts/sync-menu.mjs:5) | Build-time only |
| Google Fonts (Fraunces, Public Sans, Space Mono) | Unversioned remote CSS + WOFF2 | [index.html:13](index.html:13) and 4 other pages | **Third-party runtime code path with no Subresource Integrity.** `<link rel="stylesheet">` from `fonts.googleapis.com` with no `integrity` attribute (verified: grep for `integrity=` across all HTML returns zero matches). CSS injection via a compromised Google Fonts is a real, if remote, vector — and there is no CSP to constrain it |

**Front-end dependencies: zero.** No React, Vue, jQuery, lodash, or any library. Every line
of client JS is first-party. This is a genuine strength — the client-side dependency attack
surface is nil.

- **Lockfile: absent.** No `package-lock.json`, `deno.lock`, `yarn.lock`, or `pnpm-lock.yaml`
  (verified by `find`).
- **CI installs from lockfile: N/A — there is no CI** (§3, §23).
- **Unmaintained/EOL packages: none identifiable**, because there is no manifest to
  enumerate. `@supabase/supabase-js` v2 is the current, actively maintained major line.
- `npm audit` was **not run** (it requires network and there is no manifest to audit).

## 21. Rate limiting & abuse controls

**There is no rate limiting, no CAPTCHA, no bot detection, no proof-of-work, no IP
throttling, and no account lockout anywhere in this codebase.** The single exception:

```ts
// reconcile/index.ts:22-25 — the only throttle in the system
const last = Number(cfg.reconcile_last_run ?? "0");
if (Date.now() - last < 5 * 60 * 1000) return json({ ok: true, note: "ran recently" });
```
([reconcile/index.ts:22-25](supabase/functions/reconcile/index.ts:22))

Per-endpoint abuse posture:

| Endpoint | Limit | Abuse consequence |
|---|---|---|
| `/create-checkout` | **None** | **Order spam.** Publicly callable with a public key and `Access-Control-Allow-Origin: *`. In demo mode every request writes a `status:"paid"` row that rings the kitchen tablet and chimes ([kitchen.js:188](kitchen.js:188)); in Square mode every request also mints a real Square payment link, burning Square API quota. No CAPTCHA on the form ([order.html:78-91](order.html:78)) |
| `/kitchen-api` | **None** | **Unlimited brute-force against the kitchen key.** The comparison is constant-time ([kitchen-api/index.ts:46](supabase/functions/kitchen-api/index.ts:46)) but unthrottled and unlogged-per-attempt; key entropy is unknown (**UNVERIFIED** — depends on what was typed into `app_config.kitchen_key`). A weak key falls in minutes |
| `/order-status` | **None** | `sid` enumeration is computationally infeasible (UUIDv4), so this is a resource-consumption issue rather than a data-access one |
| `/daily-summary` | **None** | **Each call sends an email and returns revenue.** Repeated calls exhaust the Resend free tier (100/day per [supabase/functions/README.md:60](supabase/functions/README.md:60)) and flood the owner's inbox — which is the *backup order-notification channel*, so filling it degrades order handling |
| `/notify-order` | Idempotency only | Bounded by `notified_at` ([notify-order/index.ts:41](supabase/functions/notify-order/index.ts:41)) and a 1-hour staleness window ([:42-44](supabase/functions/notify-order/index.ts:42)) — a genuinely good design. Still allows order-existence probing at unlimited rate |
| `/stripe-webhook`, `/square-webhook` | **None** | Unauthenticated requests are cheap to reject, but each one triggers a DB read of `app_config` ([square-webhook:38](supabase/functions/square-webhook/index.ts:38)) before signature checking — an amplification primitive against the database |
| PostgREST `/rest/v1/*` | Supabase platform defaults | **UNVERIFIED** |

**The KDS polls every 5 seconds** ([kitchen.js:19](kitchen.js:19)) — 17k invocations/day
per tablet, dropping to 60s when closed ([kitchen.js:23](kitchen.js:23)). Combined with an
unmetered public `create-checkout`, Supabase's function-invocation quota is itself a
denial-of-wallet target.

## 22. Logging, monitoring, audit trail

- **Logging is `console.error` / `console.log` to Supabase's function logs only.** Complete
  inventory: 19 call sites across the 8 functions (listed in full below). There is no
  structured logger, no log shipping, no retention policy, and no alerting on log content.
  - [create-checkout:72](supabase/functions/create-checkout/index.ts:72), [:91](supabase/functions/create-checkout/index.ts:91), [:96](supabase/functions/create-checkout/index.ts:96), [:204](supabase/functions/create-checkout/index.ts:204), [:215](supabase/functions/create-checkout/index.ts:215), [:256](supabase/functions/create-checkout/index.ts:256), [:263](supabase/functions/create-checkout/index.ts:263)
  - [stripe-webhook:62](supabase/functions/stripe-webhook/index.ts:62), [:74](supabase/functions/stripe-webhook/index.ts:74)
  - [square-webhook:40](supabase/functions/square-webhook/index.ts:40), [:51](supabase/functions/square-webhook/index.ts:51), [:57](supabase/functions/square-webhook/index.ts:57), [:78](supabase/functions/square-webhook/index.ts:78), [:91](supabase/functions/square-webhook/index.ts:91), [:98](supabase/functions/square-webhook/index.ts:98)
  - [kitchen-api:41](supabase/functions/kitchen-api/index.ts:41), [reconcile:58](supabase/functions/reconcile/index.ts:58), [notify-order:69](supabase/functions/notify-order/index.ts:69), [daily-summary:63](supabase/functions/daily-summary/index.ts:63)
- **PII in logs: minimal and mostly avoided.** Logs carry order **codes**
  ([reconcile:58](supabase/functions/reconcile/index.ts:58),
  [square-webhook:98](supabase/functions/square-webhook/index.ts:98)), payment ids
  ([square-webhook:78](supabase/functions/square-webhook/index.ts:78)), session ids
  ([stripe-webhook:74](supabase/functions/stripe-webhook/index.ts:74)) and DB error strings.
  **No customer name, phone, or notes is ever logged** — verified by reading each call site.
  **No card data is logged** (none exists to log).
  Two caveats: [notify-order:69](supabase/functions/notify-order/index.ts:69) and
  [daily-summary:63](supabase/functions/daily-summary/index.ts:63) log the **full Resend
  response body** on failure, which can echo recipient addresses; and
  [create-checkout:96](supabase/functions/create-checkout/index.ts:96) logs a raw
  `app_config` value (`tax_rate`) — harmless for that key, but it is the pattern of logging
  config values from a table that also holds payment secrets.
- **Error verbosity to clients: good.** Every 5xx returns a generic string — "Ordering is
  temporarily unavailable", "Could not create the order", "Payment setup failed" — with the
  real reason kept server-side ([create-checkout:73](supabase/functions/create-checkout/index.ts:73),
  [:110](supabase/functions/create-checkout/index.ts:110), [:205](supabase/functions/create-checkout/index.ts:205),
  [:217](supabase/functions/create-checkout/index.ts:217)). **No stack trace is ever
  returned to a client**, and no `error.message` from Postgres is forwarded. The one
  detail leaked is by design: `kitchen-api` distinguishes 401 "Wrong kitchen key" from 503
  "Temporarily unavailable" ([kitchen-api:42](supabase/functions/kitchen-api/index.ts:42),
  [:47](supabase/functions/kitchen-api/index.ts:47)) — a deliberate trade so a DB blip
  doesn't log the tablet out.
- **Audit trail: none. This is a material gap.** There is no `order_events` table, no
  `changed_by`, no actor identity, and no immutable history. `orders` carries only a mutable
  `status` and `updated_at` ([kitchen-api:61](supabase/functions/kitchen-api/index.ts:61)).
  Concretely: when a paid order is cancelled ([kitchen-api:73-77](supabase/functions/kitchen-api/index.ts:73)),
  **nothing records who cancelled it, when, from which device, or why** — and since all
  kitchen staff share one key (§5), there is no actor to record even in principle. Price
  changes (`menu_items.price_cents`, rewritten wholesale by
  [scripts/sync-menu.mjs:41-47](scripts/sync-menu.mjs:41)) leave no history either. Refunds
  happen entirely in the provider dashboard (§11) and are never reflected in our data. **A
  dispute over "I paid and you cancelled it" is currently unresolvable from our records.**
- **Monitoring:** one external scheduled health check — a Claude scheduled task
  (`lilys-health-check`, daily 15:30 UK) that curls the order page, `order-status`,
  `menu_items` and the `kitchen-api` auth path
  ([supabase/functions/README.md:69-73](supabase/functions/README.md:69)); the exact
  commands survive in [.claude/settings.local.json:5-13](.claude/settings.local.json:5).
  **Daily granularity** — a payment outage could run ~24 hours undetected. UptimeRobot is
  suggested but not configured ([supabase/functions/README.md:72-73](supabase/functions/README.md:72)).
  `reconcile` is the real safety net for missed payments
  ([reconcile/index.ts:1-5](supabase/functions/reconcile/index.ts:1)) — **but it only
  covers Stripe** ([:19-20](supabase/functions/reconcile/index.ts:19)), and Square is the
  chosen provider.

## 23. Existing tests & CI security posture

| Control | Status |
|---|---|
| Test framework | **None.** No test file, no `__tests__`, no `*.test.*`, no `*.spec.*`, no Deno test, no Playwright/Cypress config anywhere in the tree |
| Test coverage | **Zero.** Not a single automated test exists for the cart, the pricing path, the state machine, or the webhook signature verification |
| CI/CD | **None.** No `.github/` directory (verified: `ls .github` → No such file or directory); no CI config of any kind |
| SAST / linting | **None.** No ESLint, Biome, `deno lint` config, Semgrep, or CodeQL |
| DAST | **None** |
| Secret scanning | **None configured in-repo.** GitHub's default push protection may apply at the platform level — **UNVERIFIED**, needs the GitHub repo settings page |
| Dependency bots | **None.** No Dependabot or Renovate config — and with no manifest or lockfile there is nothing for them to read |
| Branch protection | **UNVERIFIED — not determinable from a local clone.** Only `main` exists locally and on origin (`git branch -a`). The working style is direct commits to `main` (16 commits, no merge commits, no feature branches in history). Resolve via GitHub → Settings → Branches |
| Deploy verification | Manual, human-run, per the runbook ([supabase/functions/README.md:44](supabase/functions/README.md:44), [:84](supabase/functions/README.md:84)) |
| Design/security review artifact | One prior **design** (not security) review: `.claude/design-review-findings.json`, 140 KB, gitignored |

The only automated check of any kind that touches this system is the daily
`lilys-health-check` scheduled task described in §22 — a liveness probe, not a security
control.

---

# Top 10 attack targets

Ranked by financial impact × exploitability.

1. **Demo mode is a silent free-food fallback, and the guard meant to prevent it cannot
   fire.** [create-checkout/index.ts:78-93](supabase/functions/create-checkout/index.ts:78).
   If both providers' credentials are absent — an unset token, a rotated Square key, a
   deleted `app_config` row, an expired credential — `provider` resolves to `""`, `demo`
   becomes `true`, and every order is written **`status: "paid"` with no money collected**
   ([:131](supabase/functions/create-checkout/index.ts:131)). The loud-refusal guard at
   [:90](supabase/functions/create-checkout/index.ts:90) is `if (!demo && wanted === "square" && !squareReady)`,
   which is unreachable in exactly the scenario it names: when Square is selected and its
   credentials are missing, `demo` is already `true`, so the check is skipped. The code
   comment two lines above asserts "Demo mode ONLY when neither is configured (never a
   silent fallback)" — the fallback is real and the comment is wrong. Demo orders also
   **bypass the opening-hours check** ([:101-104](supabase/functions/create-checkout/index.ts:101)),
   so they can be placed 24/7. Given the current commit ships Square as the selected
   provider with credentials to be pasted in later
   ([supabase/functions/README.md:32-36](supabase/functions/README.md:32)), **the system is
   very likely in this state right now.**

2. **Row Level Security on `orders` and `app_config` is unverified, and the anon key is
   public.** [data.js:50](data.js:50) ships a working PostgREST credential to every
   visitor, and [.claude/settings.local.json:12](.claude/settings.local.json:12) proves
   `/rest/v1/` answers to it. If `orders` has no RLS policy, `GET /rest/v1/orders?select=*`
   returns every customer's name, phone and free-text notes. If `app_config` has no policy,
   the same request yields the **Square access token, both webhook signature keys, the
   Resend key and the kitchen key** — every secret in the system, from an anonymous
   request. This is one HTTP call away from either total breach or total non-event, and
   nothing in the repository tells you which.

3. **`create-checkout` is unauthenticated, unthrottled, CORS-`*`, and writes to the
   kitchen.** [create-checkout/index.ts:39](supabase/functions/create-checkout/index.ts:39)
   with `Access-Control-Allow-Origin: "*"` at [:8](supabase/functions/create-checkout/index.ts:8).
   There is no CAPTCHA, no rate limit, and no IP throttle anywhere in the system (§21). In
   demo mode a script generates unlimited fake **paid** tickets that chime the tablet
   ([kitchen.js:188](kitchen.js:188)); in Square mode each request mints a real Square
   payment link. This buries real orders in noise during a dinner rush — a restaurant-level
   denial of service that costs nothing to run.

4. **One shared, non-expiring kitchen key in `localStorage`, on the same origin as the
   public site, with unlimited guesses.** Written at [kitchen.js:273](kitchen.js:273), sent
   at [:142](kitchen.js:142), checked at [kitchen-api/index.ts:46](supabase/functions/kitchen-api/index.ts:46).
   Holding it returns every active order plus 12 hours of history with full name, phone and
   notes ([kitchen-api/index.ts:59-63](supabase/functions/kitchen-api/index.ts:59)). It has
   no expiry, no rotation, no lockout, and no rate limit — and because `kitchen.html` is
   served from the customer origin, **any XSS anywhere on the public site steals it**. Its
   entropy is whatever a human typed into a config row.

5. **PostgREST filter injection in the Stripe webhook.**
   [stripe-webhook/index.ts:59](supabase/functions/stripe-webhook/index.ts:59) and
   [:70](supabase/functions/stripe-webhook/index.ts:70) interpolate `session.id` and
   `metadata.order_id` — both attacker-shaped body fields — directly into a PostgREST
   `.or()` filter-DSL string, where commas and dots are structural. It sits behind the HMAC
   check, so it is not remotely reachable today; it is the escalation that turns a leaked
   `stripe_webhook_secret` (a plaintext row in `app_config`, see #2) from "can mark my own
   order paid" into "can mark arbitrary rows paid." Note also that
   [:48](supabase/functions/stripe-webhook/index.ts:48) parses JSON outside any try/catch —
   a signed malformed body causes an unhandled 500 and an infinite retry loop.

6. **Square has no reconciliation, no refund handling, and a config-drift trap that
   silently strands paid orders.** `reconcile` — the entire safety net beneath the webhook —
   returns early unless a **Stripe** key is present
   ([reconcile/index.ts:19-20](supabase/functions/reconcile/index.ts:19)), so on the chosen
   provider it does nothing. `square-webhook` handles only `payment.*`
   ([square-webhook/index.ts:74](supabase/functions/square-webhook/index.ts:74)) — refunds
   never reach our data. And because the signature is computed over
   `notificationUrl + body` ([:28](supabase/functions/square-webhook/index.ts:28)), any
   mismatch between `app_config.square_webhook_url` and the URL registered in Square makes
   **every legitimate webhook fail verification**, leaving customers charged and orders
   frozen at `pending` with no sweep to recover them.

7. **`daily-summary` is completely unauthenticated, sends an email per call, and returns
   revenue in the response.** [daily-summary/index.ts:13](supabase/functions/daily-summary/index.ts:13);
   the response body at [:66](supabase/functions/daily-summary/index.ts:66) is
   `{ok, orders, revenue}`. Anyone who knows the URL reads the business's daily takings on
   demand, and can burn the 100/day Resend quota
   ([supabase/functions/README.md:60](supabase/functions/README.md:60)) while flooding the
   owner's inbox — which is the **backup order-notification channel**, so the spam directly
   degrades order handling. Unlike `reconcile`, it has no throttle at all.

8. **Staff can cancel any paid order with no refund, no reason, and no audit trail.**
   [kitchen-api/index.ts:30](supabase/functions/kitchen-api/index.ts:30) permits
   `paid|making|ready → canceled` from a shared key, executed at
   [:73-77](supabase/functions/kitchen-api/index.ts:73). The money stays taken — the UI says
   so outright ([kitchen.js:493](kitchen.js:493)) — and there is no `order_events` table, no
   actor, no timestamped history (§22). On the Square path there isn't even a refund link,
   because [kitchen.js:487](kitchen.js:487) gates on `stripe_payment_intent`, which the
   Square flow never populates. A charged-and-cancelled customer is a chargeback with
   nothing on our side to reconstruct.

9. **The displayed price and the charged price come from two stores kept in sync by a
   manual command.** Display: `data.js` + a 3% browser-side markup
   ([data.js:22-25](data.js:22), [order.js:24-27](order.js:24)). Charge: `menu_items`,
   written only when a human remembers to run
   [scripts/sync-menu.mjs](scripts/sync-menu.mjs) and paste its SQL
   ([supabase/functions/README.md:52-57](supabase/functions/README.md:52)). Nothing
   validates that they agree — no test, no CI, no runtime assertion (§23). This is not an
   exploit; it is the most likely way this system actually charges a customer the wrong
   amount, and [main.js:8-97](main.js:8) ships a *third* stale copy of the price list that
   no sync touches.

10. **Every function holds a service-role handle, and the public ones load all secrets into
    memory.** All 8 functions authenticate with `SUPABASE_SERVICE_ROLE_KEY` and therefore
    bypass RLS entirely (§15) — including `order-status`, an unauthenticated public GET
    ([order-status/index.ts:18](supabase/functions/order-status/index.ts:18)). Worse,
    `create-checkout` reads the **entire** `app_config` table on every request
    ([create-checkout/index.ts:70](supabase/functions/create-checkout/index.ts:70)), so the
    Square token, both webhook keys, the Resend key and the kitchen key are resident in the
    memory of a publicly callable function on every single order. There is no least-privilege
    role and no read-only client anywhere. Any information disclosure in any one function is
    a full-credential disclosure.

---

# Confidence table

| § | Section | Confidence | Reason if below High |
|---|---|---|---|
| 1 | Stack & runtime | **Medium** | Languages/frameworks/rendering model are certain from source. **Deno runtime version and TypeScript strictness are unverifiable** — no `config.toml`, `deno.json`, or `tsconfig.json` exists |
| 2 | Repo topology | **High** | Full `find` + `git ls-files` + `.gitignore` cross-checked |
| 3 | Deployment & infrastructure | **Medium** | Host and absence of CI are certain. **CDN/WAF posture at Supabase's edge and any platform rate limits are unverifiable from the repo** |
| 4 | Endpoint inventory | **High** for the 8 functions — one file each, one handler each, no dynamic registration. **Medium overall**, because the PostgREST surface at `/rest/v1/` is an endpoint set defined by DB grants, not by code |
| 5 | Authentication | **High** | Absence of an auth system is provable; all three credentials traced end to end |
| 6 | Authorization | **High** | Every check is inline and was read directly |
| 7 | Admin / kitchen surfaces | **High** | Single surface, fully read |
| 8 | Price computation | **High** | The critical claim — final amount computed server-side from DB prices — is proven by the quoted code, and the client payload provably contains no prices |
| 9 | Cart & inventory | **High** | Cart is client-only and inventory does not exist; both provable |
| 10 | Promo / discounts | **Medium** | Provably absent **from this codebase**; a provider-dashboard-level coupon would be invisible here |
| 11 | Payment integration | **High** | Both integrations read in full; SAQ A follows directly from the redirect model and the absence of any card input |
| 12 | Webhooks | **Medium** | Verification code read line by line. **`verify_jwt=false` is documented in comments but not provable from the repo** — no `config.toml` |
| 13 | Order state machine | **High** | Statuses and transitions enumerated exhaustively from `ALLOWED_FROM` plus every writer |
| 14 | Data model & PII | **Medium** | Column names are certain from query usage; **types, constraints, indexes, defaults and encryption settings are unverifiable — no migrations exist in the repo** |
| 15 | Database access layer | **Medium** | Every query call site was read and the raw-SQL/interpolation inventory is complete. **RLS status — the single most important fact in this section — is unknown** |
| 16 | Input validation | **High** | Every handler's validation block and all 23 HTML sinks were read individually |
| 17 | File uploads | **High** | Provably absent |
| 18 | Third-party & SSRF | **High** | All four outbound hosts are literals; every `fetch` call site was read |
| 19 | Secrets & config | **High** | Full git-history blob scan performed; every env var and `app_config` key traced to its read site |
| 20 | Dependencies | **Medium** | The direct list is complete and certain. **Transitive dependencies of `supabase-js` cannot be enumerated without a lockfile, and no version resolution can be reproduced** |
| 21 | Rate limiting | **High** | Exhaustive grep plus per-handler reading; the single throttle found is quoted |
| 22 | Logging & audit | **High** | All 19 log sites read; absence of an audit table follows from the complete absence of schema for one and no writer in any function |
| 23 | Tests & CI | **Medium** | Absence of tests, CI, and scanning configs is provable locally. **Branch protection and GitHub-side secret scanning are org/repo settings not visible from a clone** |

---

# Blocking unknowns

These must be resolved before a test plan can be considered complete. Ordered by how much
they change the plan.

1. **RLS policies on `orders`, `app_config`, and `menu_items`.** This single fact
   determines whether the public anon key ([data.js:50](data.js:50)) is a harmless
   identifier or a full database read. It flips Top-10 #2 between "non-issue" and "total
   breach", and it changes whether §15 and §19 describe a defended system or an open one.
   **Give me:** the Supabase MCP `list_tables` output (it reports `rls_enabled` per table)
   and `select schemaname, tablename, policyname, cmd, qual from pg_policies;`.

2. **The deployed `verify_jwt` setting for each of the 8 functions.** The repo has no
   `supabase/config.toml`, so the code comments are the only evidence. This determines
   whether `notify-order`, `reconcile` and `daily-summary` are internet-callable by anyone
   (as §4 assumes) or merely by anon-key holders — and whether the two webhook endpoints
   are correctly exempt. **Give me:** Supabase Dashboard → Edge Functions → each function's
   settings, or `supabase functions list --project-ref hytvfqydahwsrcdbnvfq`.

3. **The current values of `app_config.payment_provider`, `square_access_token`,
   `square_location_id`, and `square_webhook_signature_key` — presence/absence only, not
   the values.** This tells us whether the system is live on Square or **sitting in demo
   mode giving food away** (Top-10 #1). Everything about the money path's real-world risk
   depends on it. **Give me:** `select key, (value is not null and value <> '') as is_set,
   length(value) as len from app_config order by key;` — never the values themselves.

4. **The full database schema.** No migrations exist in the repo, so column types, NOT NULL
   and CHECK constraints, the `status` enum-vs-text decision, unique indexes on
   `orders.code`, and default values are all inferred from query usage. Constraint gaps are
   testable bugs. **Give me:** `pg_dump --schema-only` for the `public` schema, or
   `list_migrations`.

5. **The DB triggers and `pg_cron` jobs.** `orders_notify_insert` / `orders_notify_update`
   and the `reconcile-orders` / daily-summary schedules are referenced
   ([supabase/functions/README.md:18-24](supabase/functions/README.md:18)) but their
   definitions are not in the repo. They are the actual callers of three unauthenticated
   endpoints, and the trigger logic decides when money-adjacent emails fire. **Give me:**
   `select * from cron.job;` and `select tgname, pg_get_triggerdef(oid) from pg_trigger
   where not tgisinternal;`.

6. **Kitchen key entropy.** Top-10 #4's severity is entirely a function of whether this is
   32 random characters or a memorable phrase, and there is no rate limit to slow a guess.
   **Give me:** `select length(value) from app_config where key='kitchen_key';` and a
   statement of how it was generated — **not the value**.

7. **Square Dashboard webhook configuration.** Specifically the exact registered
   notification URL (byte-for-byte, versus `app_config.square_webhook_url`) and the
   subscribed event list. A URL mismatch silently breaks every payment confirmation
   (Top-10 #6), and the event list determines whether refunds are even delivered to us.
   **Give me:** Square Dashboard → Developer → Webhooks → subscription detail.

8. **GitHub repository settings:** branch protection on `main`, push protection / secret
   scanning status, GitHub Pages custom-domain and HTTPS-enforcement state, and who holds
   write access. Not visible from a clone (§23).

9. **Supabase project settings:** platform rate limits or WAF rules on Edge Functions and
   PostgREST, log retention period, PITR/backup configuration, and whether any additional
   API keys (a second anon key, a publishable key) exist beyond the one in `data.js`.

10. **The production domain plan.** Four pages currently ship
    `<meta name="robots" content="noindex,nofollow">` with a comment to remove it at the
    domain cut ([index.html:6](index.html:6), [menu.html:6](menu.html:6),
    [order.html:6](order.html:6)). Whether the test plan targets
    `zachachacker.github.io/lilys-mediterranean/` or a custom domain changes the CORS,
    redirect (`app_config.site_url`), and webhook-URL surface materially.
