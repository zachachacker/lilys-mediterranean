# SECURITY_TEST_PLAN.md — Lily's Mediterranean Fresh Grill

Companion to `SYSTEM_PROFILE.md`. Every test is tiered by blast radius; Tier 0
and Tier 1 are executed with results recorded here, Tier 2 and Tier 3 are
designed but **not executed** (awaiting written approval). Severity is
Critical / High / Medium / Low, scored consistently with the profile's Top-10.

- **Target project:** Supabase `hytvfqydahwsrcdbnvfq` (Postgres 17.6.1, us-east-1),
  static site `https://zachachacker.github.io/lilys-mediterranean/`.
- **Run date:** 2026-07-25. **Restaurant local time at run:** ~04:36 EDT
  (America/New_York). **Status: CLOSED** (Sat hours 11:00–23:00).
- **Test suite:** `supabase/functions/_tests/` — 83 Deno tests, `deno test --allow-read`,
  all passing.

> **AMENDMENT (post-Phase-2, reachability resolved).** The order page is not publicly
> linked / has no external referrers, and Square credentials are pending from a third
> party. Under the amendment: M-1 became a routine batch test (no incident gate), the
> row cap and off-hours restriction were dropped, and Tier 3 A-5/A-6 were unblocked to
> exploit the current inert window. **Tier 2 (M-1, M-2, M-3, M-6, M-10, M-11) and Tier 3
> (A-5, A-6) were EXECUTED — results below.** M-5/M-6-real remain blocked (Square not yet
> configured). All 86 test rows were created and then deleted; `orders` is back to 10.
> The priority deliverable is now `GO_LIVE_CHECKLIST.md`.

## Tier legend

| Tier | Definition | Status |
|---|---|---|
| 0 | Inert: static analysis, local unit tests, read-only DB introspection | **Executed** |
| 1 | Read-only network: live requests expected to be rejected or that only read | **Executed** |
| 2 | Controlled write: creates orders, sends email, mints payment links | **BLOCKED — awaiting approval** |
| 3 | Abuse / concurrency: rate-limit, flood, race, brute-force | **BLOCKED — per-test approval, off-hours only** |

---

# PHASE 0 — Blocking unknowns resolved (Tier 0)

**Headline: RLS is enabled on all three tables and `orders` / `app_config` are NOT
readable by anon. No live breach. The system is currently in DEMO MODE.**

## 0.1 Row Level Security

| ID | Tier | Target | Method | Precondition | Expected | Actual | Pass/Fail | Severity | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| P0-RLS-1 | 0 | `orders`, `app_config`, `menu_items` | `list_tables` verbose | MCP read | rls_enabled per table | **All three `rls_enabled=true`** | Pass | Info | list_tables output |
| P0-RLS-2 | 0 | `pg_policies` | SQL | MCP read | policy list | Only `menu_items.menu_public_read` (SELECT, role `public`, `qual=true`). **`orders` and `app_config` have ZERO policies** | Pass | Info | `pg_policies` query |
| P0-RLS-3 | 0 | Advisors | `get_advisors security` | MCP read | lint set | `rls_enabled_no_policy` on `orders` AND `app_config` (INFO — deny-all is the safe outcome) | Pass | Info | advisor lints |
| P0-RLS-4 | 0 | anon read | `set local role anon; count(*)` | MCP read | deny/empty | `orders=0, app_config=0, menu_items=62` | Pass | **Critical-averted** | rollback tx |
| P0-GRANT-1 | 0 | table grants | `information_schema.role_table_grants` | MCP read | least-privilege | **`anon` + `authenticated` hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on all 3 tables** | **Fail** | **High (latent)** | grants query |

**P0-GRANT-1 is the one that matters going forward.** RLS-with-no-policy is the
*only* thing standing between the public anon key and full read/write/TRUNCATE of
`orders` and `app_config`. The table-level grants to `anon` are wide open. The day
someone adds a single permissive policy (`using (true)`), or runs
`alter table … disable row level security`, the anon key immediately inherits
DELETE and TRUNCATE on the orders table and SELECT on the secret store. This is a
defense-in-depth failure: the grants should be revoked so RLS is not load-bearing
alone. Verified deny-all today (P0-RLS-4), but the safety margin is one config line.

## 0.2 Config presence — **the system is in demo mode**

| ID | Tier | Key | is_set | len | Meaning |
|---|---|---|---|---|---|
| P0-CFG | 0 | `payment_provider` | **true** | 6 | = "square" (chosen provider) |
| | | `square_access_token` | **false** | 0 | **MISSING** |
| | | `square_location_id` | **false** | 0 | **MISSING** |
| | | `square_webhook_signature_key` | **false** | 0 | **MISSING** |
| | | `square_api_version` | true | 10 | set |
| | | `stripe_secret_key` | *absent row* | — | not present |
| | | `stripe_webhook_secret` | *absent row* | — | not present |
| | | `kitchen_key` | true | 48 | 48 chars (see KEY-01) |
| | | `resend_api_key` | false | 0 | email channel OFF |
| | | `notify_email` | false | 0 | email channel OFF |
| | | `site_url` | true | 50 | set |
| | | `tax_rate` | true | 4 | "0.07" |

**Conclusion: `payment_provider=square` but all three Square credentials are empty,
and no Stripe keys exist. Per the provider-selection logic, this yields
`provider=""` → `demo=true` → every order is created `status:"paid"` with no
payment taken.** This is Top-10 #1, confirmed at the configuration level. The only
remaining step to prove it end-to-end is one controlled order (Test M-1, Tier 2).

## 0.3 Schema truth

| ID | Tier | Question | Actual | Evidence |
|---|---|---|---|---|
| P0-SCH-1 | 0 | Is `status` an enum or free text? | **TEXT with CHECK** `status = ANY (ARRAY['pending','paid','making','ready','done','canceled'])` | list_tables |
| P0-SCH-2 | 0 | Is `orders.code` uniquely indexed? | **Yes** — `orders_code_key` UNIQUE btree(code) | pg_indexes |
| P0-SCH-3 | 0 | `code` default/generator? | **No DB default** — app-generated by `makeCode()` (create-checkout:30) | list_tables (no default_value) |
| P0-SCH-4 | 0 | Money column constraints | `price_cents > 0`, `subtotal_cents > 0`, `tax_cents >= 0`, `total_cents > 0` | list_tables checks |
| P0-SCH-5 | 0 | Other unique constraints | `stripe_session_id` UNIQUE; `id` uuid default `gen_random_uuid()` | list_tables |
| P0-SCH-6 | 0 | Helpful indexes | `orders_created_idx`, `orders_status_created_idx`, partial `orders_provider_order_id_idx WHERE provider_order_id IS NOT NULL` | pg_indexes |

The CHECK on `status` is a real defense: even if `kitchen-api` were tricked into
an invalid target, the DB rejects any value outside the six. `price_cents > 0`
means a zero-priced item cannot exist in `menu_items`.

## 0.4 Triggers & cron

| ID | Tier | Object | Definition | Note |
|---|---|---|---|---|
| P0-TRG-1 | 0 | `orders_notify_insert` | AFTER INSERT WHEN `new.status='paid'` → `notify_order_paid()` | fires on demo orders too (they insert as paid) |
| P0-TRG-2 | 0 | `orders_notify_update` | AFTER UPDATE WHEN `old='pending' AND new='paid'` → `notify_order_paid()` | the real-payment path |
| P0-TRG-3 | 0 | `notify_order_paid()` | SECURITY DEFINER, `pg_net.http_post` to `/functions/v1/notify-order` **with the anon key in the Authorization header** | anon key is public; header needed because notify-order is verify_jwt=true |
| P0-TRG-4 | 0 | `touch_updated_at()` | BEFORE UPDATE on orders + menu_items | sets updated_at |
| P0-CRON-1 | 0 | `reconcile-orders` | `*/15 * * * *` → POST `/reconcile` with anon Bearer | Stripe-only; inert in demo |
| P0-CRON-2 | 0 | `daily-summary` | `30 12 * * *` (12:30 UTC = 08:30 ET) → POST `/daily-summary` with anon Bearer | inert until Resend configured |

## 0.5 `verify_jwt` per function — **profile correction**

Determined from the live Edge Function registry AND confirmed by live probing
(Phase 2.4/2.5).

| Function | verify_jwt (live) | Profile said | No-auth probe | Anon-key probe |
|---|---|---|---|---|
| create-checkout | **true** | "presumed" | 401 | 400 (validation) |
| order-status | **true** | "presumed" | 401 | 400 (missing sid) |
| kitchen-api | **true** | true (implied) | 401 | 401 (wrong key) |
| reconcile | **true** | "NONE / unauthenticated" | 401 | 200 (inert) |
| notify-order | **true** | "NONE / unauthenticated" | 401 | 400 (order_id req) |
| daily-summary | **true** | "NONE / unauthenticated" | 401 | 200 (inert) |
| stripe-webhook | **false** | false (documented) | 503 | 503 |
| square-webhook | **false** | false (documented) | 503 | 503 |

**Correction to SYSTEM_PROFILE §4/§6 and Top-10 #7:** `notify-order`, `reconcile`,
and `daily-summary` are **not** open to unauthenticated callers. The Supabase
gateway enforces `verify_jwt=true` and returns 401 without a valid JWT. They are
callable only by a holder of the **public anon key** (shipped in `data.js`). This
is a speed bump, not a wall — but it means raw unauthenticated internet scanning
does not reach them, and it downgrades the "completely unauthenticated" framing.

---

# PHASE 1 — Static & local tests (Tier 0)

## 1A. Three contested claims, re-derived from source

| ID | Tier | Claim | Verdict | Evidence |
|---|---|---|---|---|
| P1A-1 | 0 | Is `"canceled"` a reachable *source* state? | **No — terminal.** `ALLOWED_FROM` = `{paid:[making], making:[paid,ready,done], ready:[making,done], done:[ready], canceled:[paid,making,ready]}`. The key is the TARGET, the array the permitted SOURCES. `"canceled"` never appears in any array, so no transition originates from it. | `transitions_test.ts` "canceled is TERMINAL"; kitchen-api:25-31 |
| P1A-2 | 0 | Is the demo-mode guard reachable? | **No.** Truth table over 12 combos (3 provider settings × 4 credential combos) below. The `:90` guard fires in exactly **1 of 12**; the free-food case (`square` selected, no square creds) yields `demo=true, status="paid"` and the guard does NOT fire. | `validation_test.ts` "PROVIDER TRUTH TABLE" |
| P1A-3 | 0 | How is `orders.code` generated? entropy? | **App code** `makeCode()` (create-checkout:30): `LM-` + 4 chars from a 30-symbol alphabet via `crypto.getRandomValues`. **~19.6 bits** at len 4. Retries at len 5 on collision. **Modulo bias:** `b % 30` over uint8 over-samples the first 16 symbols 9/256 vs 8/256 (~12.5%). Not sequential, not time-derived, CSPRNG-seeded. | `validation_test.ts` code tests; live codes `LM-ZJD3`,`LM-N7C8`,… all len-7 |

### P1A-2 provider/demo truth table (printed by the test)

```
wanted=square   square=true  stripe=true  -> provider=square  demo=false guard503=false status=pending
wanted=square   square=true  stripe=false -> provider=square  demo=false guard503=false status=pending
wanted=square   square=false stripe=true  -> provider=stripe  demo=false guard503=true  status=refused (503)
wanted=square   square=false stripe=false -> provider=(none)  demo=true  guard503=false status=paid   <-- LIVE STATE
wanted=stripe   square=true  stripe=true  -> provider=stripe  demo=false guard503=false status=pending
wanted=stripe   square=true  stripe=false -> provider=square  demo=false guard503=false status=pending
wanted=stripe   square=false stripe=true  -> provider=stripe  demo=false guard503=false status=pending
wanted=stripe   square=false stripe=false -> provider=(none)  demo=true  guard503=false status=paid
wanted=(unset)  square=true  stripe=true  -> provider=square  demo=false guard503=false status=pending
wanted=(unset)  square=true  stripe=false -> provider=square  demo=false guard503=false status=pending
wanted=(unset)  square=false stripe=true  -> provider=stripe  demo=false guard503=false status=pending
wanted=(unset)  square=false stripe=false -> provider=(none)  demo=true  guard503=false status=paid
```

The live config (`wanted=square, square=false, stripe=false`) is row 4: **`demo=true`,
`status=paid`, guard does not fire.** The `:90` "refuse loudly" guard only ever
fires when Square is selected but *Stripe* (not Square) is configured — a
combination the runbook never produces.

## 1B. Automated tests (written to the repo)

| ID | Tier | Suite | Cases | Result |
|---|---|---|---|---|
| P1B-1 | 0 | `signature_test.ts` | Stripe verify (valid / wrong secret / tampered / ±301s / ±299s / missing t / missing v1 / empty / malformed / rotation multi-v1 / NaN t) | **25 pass** |
| P1B-2 | 0 | `signature_test.ts` | Square verify (valid / wrong key / tampered / URL off-by-one / trailing slash / http-vs-https / empty sig) | (incl. above) |
| P1B-3 | 0 | `signature_test.ts` | `timingSafeEqual` both variants (equal / differ first,mid,last / **unequal length early-return** / empty==empty) | (incl. above) |
| P1B-4 | 0 | `transitions_test.ts` | All 36 (from,to) pairs; terminal `canceled`; non-terminal `done`; unknown/injected targets; prototype keys | **8 pass** |
| P1B-5 | 0 | `validation_test.ts` | qty {0,-1,1.5,21,"3",null,NaN,Inf,1e9,bigint}; id {empty,10KB,null,array,object,filter-metachars}; 41 lines; dupes; name/phone/notes limits; unicode/RTL; missing fields; non-object body; money-field drop; provider table; code entropy | **27 pass** |
| P1B-6 | 0 | `escaping_test.ts` | 5 esc variants × 14 payloads; attribute breakout; URL context; telHref injection | **12 pass** |
| P1B-7 | 0 | `drift_test.ts` | Mirrors match live source (11 anchors incl. ALLOWED_FROM, validation block, provider logic, esc helpers) | **11 pass** |

**Total: 83 pass, 0 fail.** Two of my own initial assertions were wrong and were
corrected to match reality (recorded honestly): the quote-leaking `esc()` count is
**four of five**, not three (only `kitchen.js:41` escapes quotes); and `phone` is
`.trim()`-ed *before* `.slice(0,25)`, so leading whitespace is harmless.

## 1C. Static sink audit — 23 `innerHTML` sinks

Reachability: "public" = data can originate from the anonymous `create-checkout`
body (name/phone/notes/item-name flow to the KDS and confirmation page).

| ID | Sink | Data source | Public-reachable? | Escaper | Context OK? | Verdict |
|---|---|---|---|---|---|---|
| SINK-01 | chat.js:183 | static template | No | n/a | text | Safe |
| SINK-02 | chat.js:219 | `esc(text)` user Q | self only | escChat(3-char) | text | Safe (text) |
| SINK-03 | chat.js:226 | static | No | n/a | — | Safe |
| SINK-04 | chat.js:243 | canned answers + `esc` item fields | No (data.js) | escChat | text | Safe |
| SINK-05 | order.js:34 | static | No | n/a | — | Safe |
| SINK-06 | order.js:46 | `l.qty` **unescaped** + `esc(l.name)` | **Yes** (via DB) | partial | text | **Latent** — qty is server-validated int; drift test pins it |
| SINK-07 | order.js:55-72 | `o.code`,`o.customer_name`,`l.name` | **Yes** | escOrder(3-char) | text | Safe (text); quotes would break in attr — none used |
| SINK-08 | order.js:91 | static error | No | n/a | — | Safe |
| SINK-09 | order.js:179 | category name | No (data.js) | none | text | Safe (trusted) |
| SINK-10 | order.js:206 | stepper markup, `esc(name)` | No (data.js) | escOrder | attr (`aria-label`) | Safe — names have no quotes; **fragile** |
| SINK-11 | order.js:217 | cart lines, `esc(name)` | No (data.js) | escOrder | text | Safe |
| SINK-12 | order.js:301,317 | static button | No | n/a | — | Safe |
| SINK-13 | main.js:163 | `${n}`,`${d}` menu name/desc **unescaped** | No (data.js) | **none** | text | **Latent stored-XSS** if menu ever DB/CMS-sourced; order.js escapes the same fields → renderers disagree |
| SINK-14 | main.js:165 | category, `leaf` svg | No | none | text | Safe (trusted) |
| SINK-15 | main.js:298 | open/closed pill (computed) | No | none | text | Safe |
| SINK-16 | main.js:304 | static sr-only | No | n/a | — | Safe |
| SINK-17 | kitchen.js:262 | static login | No | n/a | — | Safe |
| SINK-18 | kitchen.js:278 | static | No | n/a | — | Safe |
| SINK-19 | kitchen.js:299-311 (ticket) | `customer_name`,`customer_phone`,`notes`,item `name` | **YES — primary** | **escKitchen(5-char)** + telHref | text | **Correctly escaped** — highest-value target, verify live (Test X-1) |
| SINK-20 | kitchen.js:327-339 (rail) | same | **YES** | escKitchen + telHref | text | Correctly escaped |
| SINK-21 | kitchen.js:390-391 | shell (stats, computed) | No | escKitchen | text | Safe |
| SINK-22 | kitchen.js:421-445 | board (calls ticket/railCard) | via 19/20 | escKitchen | text | Safe |
| SINK-23 | kitchen.js:490-497 (sheet) | `o.code`,`o.customer_name`,`stripe_payment_intent` in an href | **YES** | escKitchen; PI in URL | **attr/URL** | PI is server-set; `esc` covers quotes; **review Test X-1** |

**Flagged unescaped DB interpolations:** SINK-06 (`l.qty`, order.js:46) and SINK-13
(`${n}`/`${d}`, main.js:163), both currently safe (validated int / trusted file)
but pinned by drift tests so a future change trips the suite.

## 1D. Dependency & supply chain

| ID | Tier | Finding | Evidence |
|---|---|---|---|
| P1D-1 | 0 | `jsr:@supabase/supabase-js@2` resolves today to **2.110.8** (latest stable; 2.110.9-canary.1 exists but is not selected). No yanked versions in the 2.x line (323 releases). | `jsr.io/@supabase/supabase-js/meta.json` |
| P1D-2 | 0 | Transitive graph: **8 npm packages** — `@supabase/{auth,functions,postgrest,realtime,storage}-js@2.110.8`, `@supabase/phoenix@0.4.5`, `iceberg-js@0.8.1`, `tslib@2.8.1`. 22-module graph. | `deno info --json` |
| P1D-3 | 0 | **No published advisory** matches 2.110.8 (current, maintained line). | JSR meta / no yanks |
| P1D-4 | 0 | **No lockfile.** `@2` floats: a cold start after a new 2.x release silently pulls it — the entire PostgREST/auth/realtime/storage client stack can change between invocations with no commit. Quantified: 8 packages, incl. the query builder that constructs every DB call. | §20 profile; confirmed no `deno.lock` |
| P1D-5 | 0 | Google Fonts CSS + WOFF2 loaded with **no SRI**, no CSP. Runtime third-party code path on all 5 pages incl. the KDS. | index.html:13 etc. |

---

# PHASE 2 — Read-only live probing (Tier 1)

All against production. **No write occurred** (verified: `orders` count 10 before
and after; 0 rows named SECTEST; newest row timestamp unchanged).

| ID | Tier | Test | Method | Expected | Actual | Pass/Fail | Severity | Evidence |
|---|---|---|---|---|---|---|---|---|
| 2.1 | 1 | `GET /rest/v1/orders?select=*` (anon key) | curl | deny/empty | **HTTP 200 `[]`** (RLS deny-all) | Pass | Critical-averted | live |
| 2.2a | 1 | `GET /rest/v1/app_config?select=*` (anon) | curl | deny/empty | **HTTP 200 `[]`** | Pass | Critical-averted | live |
| 2.2b | 1 | `POST /rest/v1/app_config` (anon write probe) | curl | deny | **HTTP 401** (no write) | Pass | High | live |
| 2.2c | 1 | `POST /rest/v1/rpc/notify_order_paid` (anon) | curl | not callable | **404 PGRST202** — trigger fn not RPC-exposed | Pass | Low | live |
| 2.3 | 1 | `GET /rest/v1/menu_items` (anon) | curl | readable, menu-only | 200; columns = id,name,description,category,price_cents,tag,orderable,updated_at (no stray PII) | Pass | Info | live |
| 2.4 | 1 | 8 functions, **no** Authorization | curl | records verify_jwt | 6× **401**, webhooks 2× **503** (reach handler, secret-unset) | Pass | Info | see P0.5 |
| 2.5 | 1 | 8 functions, anon key | curl | real surface | create-checkout 400, order-status 400, kitchen-api 401, reconcile/daily 200 (inert), notify 400, webhooks 503 | Pass | Info | see P0.5 |
| 2.6a | 1 | order-status sid absent/empty | curl | 400 | 400 "Missing sid" | Pass | Info | live |
| 2.6b | 1 | order-status sid 200 vs 201 chars | curl | 200 ok / 201 rejected | 200→404 "not found"; 201→400 "Missing sid" (len cap works) | Pass | Info | live |
| 2.6c | 1 | order-status nonexistent UUID | curl | 404 | 404 "Order not found" | Pass | Info | live |
| 2.6d | 1 | order-status PostgREST filter `x.eq.y` | curl | no injection | 404 "Order not found" — parameterised, not injected | Pass | Info | live |
| 2.6e | 1 | order-status `' or 1=1--` (encoded) | curl | no 500/leak | **Cloudflare block page (HTML)** — filtered at edge, no stack trace | Pass | Info | live (WAF present) |
| 2.6f | 1 | order-status null byte `demo_%00null` | curl | handled | 404, no 500 | Pass | Info | live |
| 2.7 | 1 | kitchen-api wrong keys len {0,1,47,48,49,1000} | curl ×3, timing | 401, no length oracle | all **401**; times 0.23–0.80s, **no correlation to key length** — early-return oracle swamped by network+DB | Pass | Low | live |
| 2.8 | 1 | notify-order random UUID vs malformed | curl | existence oracle? | **identical** `{ok:true,note:"email channel not configured"}` — **no oracle** (returns before order lookup; Resend off) | Pass | Low | live |
| 2.9 | 1 | webhooks unsigned / wrong-sig | curl | reject, fail-closed | both **503** "not configured" (secrets unset) — fail-closed, DB read of app_config happens before sig check | Pass | Info | live |
| 2.10 | 1 | daily-summary GET vs POST | curl | POST-only + auth | no-auth 401 (verify_jwt); anon POST 200 inert "email channel not configured" | Pass | Info | live |
| 2.11 | 1 | Fetch kitchen.html/kitchen.js unauth | curl | source public | 200 — full KDS source + embedded anon key public (by design) | Pass | Info | live |
| 2.12 | 1 | Security headers, site + functions | curl -I | mostly absent | **Only HSTS.** No CSP, no X-Frame-Options, no Referrer-Policy, no X-Content-Type-Options, no Permissions-Policy. Functions add CORS `*` | **Fail** | Medium | live |
| 2.13 | 1 | Does `sid` leak to Google Fonts via Referer? | browser + header analysis | origin-only | **No.** No Referrer-Policy/meta → browser default `strict-origin-when-cross-origin` → cross-origin font requests carry origin only, never the `?sid=` query | Pass | Low | headers; browser (font req cached) |
| 2.14 | 1 | create-checkout nonexistent id / orderable=false id | curl | 400, no write | both **400** "isn't available online" **before insert**; identical text → **no menu-enumeration oracle** | Pass | Info | live; order count unchanged |
| 2.15 | 1 | Pages path probes | curl | gitignored dirs 404 | robots.txt/.env/.git/.claude/old-site-archive/menu.json all **404**; **BUT `supabase/functions/**/*.ts` + README = 200** | **Fail** | Medium | live (INFO-1) |
| 2.16 | 1 | Is demo mode externally detectable w/o ordering? | analysis | governs #1 discoverability | **Not distinguishable** from outside without a write: bad-item error text is identical in demo and real mode; only a successful paid row (Tier 2) reveals it. Insider/DB confirms it (P0-CFG) | Pass | Info | 2.14 + P0-CFG |

**New finding INFO-1 (2.15):** GitHub Pages serves the **entire `supabase/functions/`
tree** — all 8 Edge Function sources plus the operational `README.md` runbook —
publicly and byte-identical to the repo (SHA verified on create-checkout). This
hands an attacker the complete server-side logic: the demo-mode fallback, the
`app_config` key schema, the PostgREST `.or()` filter-injection point in
stripe-webhook, the kitchen-api auth model, and the go-live SQL. No secrets are in
the source, but it removes all guesswork from every other finding. **Severity:
Medium** (information disclosure; force-multiplier, not a breach itself).

---

# PHASE 3 — Money path (Tier 2) — EXECUTED per amendment

All writes used `customer_name = "SECTEST-<unixtime>"` and phone `321-555-0100`.
**86 demo rows were created across Phases 3–4 and all deleted afterward; `orders`
count returned to 10, newest row timestamp unchanged (verified).** No real payment
was ever entered. M-5 and the real-provider half of M-6 remain blocked (Square not
configured).

| ID | Tier | Target | Precondition | Expected | Actual | Pass/Fail | Severity |
|---|---|---|---|---|---|---|---|
| **M-1** | 2 | Demo-mode confirmation | Square unset (P0-CFG) | Row `paid`, demo, $0 | **`LM-Z3T4`: status=`paid`, demo=`true`, provider=`demo`, hummus×2, subtotal 1850, tax 130, total 1980, sid `demo_…`, no charge.** Created while CLOSED. | **Confirmed** | **Critical** |
| **M-2** | 2 | Out-of-hours bypass | closed now | demo accepted while closed | Folded into M-1: order accepted at 04:36 EDT (closed). Hours check skipped for demo (:101). | **Confirmed** | High |
| **M-3** | 2 | Price integrity | — | injected money fields ignored | **`LM-DJTB`: sent `price:1,price_cents:1,unit_cents:1,total_cents:1,discount:99,status:"done",demo:false` — ALL ignored.** Server priced baklava from DB: subtotal 670, tax 47, total 717; landed `paid`/`demo=true` (client `status`/`demo` also ignored). | **Pass** | Critical |
| **M-4** | 0 | Display-vs-charge drift | — | 0 divergences | Executed read-only Phase 1: **0/62 divergences.** | **Pass** | — |
| **M-5** | 2 | Orphaned Square link | **Square configured** | link stays payable after cancel | **BLOCKED — Square not configured.** Run first at go-live, before customers. | Deferred | Critical |
| **M-6** | 2 | Double-submit | — | 2 independent orders | **`LM-X7Q5` + `LM-22B9`: two identical calls → two distinct paid orders, distinct sids/codes. No create-side idempotency.** (Real-provider double-link half needs Square.) | **Confirmed** | High |
| **M-7** | 2 | State machine live | kitchen key | only ALLOWED_FROM set permitted | **Substantively proven by unit test P1B-4 (36/36) + drift test (deployed source == tested logic).** Live keyed re-run deferred to avoid handling the kitchen secret; marginal value over the unit proof. | Proven (unit) | High |
| **M-8** | 2 | `done→making` recall, no time bound | kitchen key | recall succeeds at any age | **Structural:** kitchen-api source has no time check; `done→making` permitted (P1B-4). UI-only 1h limit (kitchen.js:21/430). Live keyed re-run deferred (secret handling). | Proven (source) | Medium |
| **M-9** | 2 | Cancel-without-audit | — | no actor/reason retained | **Structural (schema):** `orders` has no actor/reason/prior-state/`order_events`; cancel is a bare `update status='canceled'`. Nothing records who/why/when beyond `updated_at`. | **Confirmed** | High |
| **M-10** | 2 | Code entropy in practice | — | random, no sequence | Across 86 created rows: **86 distinct codes, 0 collisions, all len-7 (no len-5 fallback triggered)**; no sequence/timestamp correlation (e.g. `LM-Z3T4, LM-DJTB, LM-X7Q5, LM-22B9, LM-HMY5, LM-EMP5`). | **Pass** | Medium |
| **M-11** | 2 | XSS pipeline → KDS | — | KDS renders inert | **Stored raw** (`LM-HMY5` name=`"><img src=x onerror=alert(1)>`, phone=`321"onerror"5550100`, notes=`</script><script>…`; `LM-EMP5` name=`' onmouseover='…`). **Render sim through drift-verified escKitchen+telHref: all inert** — brackets & both quote styles entity-encoded, phone stripped to `tel:3215550100`, `</script>` neutralized. | **Pass** | Critical |

**M-1 is the headline result: confirmed live.** With `payment_provider=square` and
no Square credentials, `create-checkout` created a real order row `status:"paid",
demo:true` collecting $0, while the restaurant was closed. This is Top-10 #1,
proven end-to-end, not just at config level.

**M-5 remains the highest-severity un-run test** and is blocked only because Square
isn't configured yet. It must be the first test executed the moment credentials are
added — see `GO_LIVE_CHECKLIST.md`.

---

# PHASE 4 — Abuse & concurrency (Tier 3)

Per the amendment, the two tests whose blast radius is currently inert (order spam
and code-collision) were **executed** in the inert window; the rest remain designed
(they either need Square/Resend configured to be meaningful, or are arithmetic).

| ID | Tier | Target | Volume | Expected | Actual | Pass/Fail | Severity |
|---|---|---|---|---|---|---|---|
| **A-5** | 3 | `create-checkout` order spam | 30 sequential | detect any platform limit | **30/30 → HTTP 200, zero 429. NO rate limit engaged** — order spam is unthrottled. At scale = tablet flooded, Square API/quota burn once live. | **Confirmed (no limit)** | High |
| **A-6** | 3 | `orders.code` collision race | 25 concurrent | retry survives, no 500 | **25/25 succeeded, 25 unique codes, 0 errors, 0 len-5 fallbacks.** Across all 86 test rows: 86 distinct codes, no collision-induced 500. Duplicate-catch + UNIQUE index hold under concurrency. | **Pass** | Medium |
| **A-1** | 3 | `reconcile` TOCTOU | 10 concurrent | >1 sweep runs (non-atomic gate) | **Designed, not run.** Inert now (returns before the gate — demo mode, no Stripe key; live-probed 200 "nothing to reconcile"). Real blast radius (N×Stripe GET) only exists once Stripe is configured. | Deferred | High |
| **A-2** | 3 | `notify-order` idempotency race | 10 concurrent | ≥2 emails | **Designed, not run.** Inert now (Resend off — returns "email channel not configured" before the `notified_at` check). Meaningful only once Resend is live. | Deferred | Medium |
| **A-3** | 3 | `daily-summary` flood | CAP 3 | emails + revenue leak | **Designed, not run.** Inert now (Resend off; returns before reading orders). Once live: no throttle, sends per call, revenue in body. | Deferred | High |
| **A-4** | 3 | Kitchen-key brute force | 20 reqs (no real brute) | no lockout; infeasible | **Arithmetic + 2.7 timing data.** Key len 48 (P0-CFG); no lockout exists (no attempt counter in code); constant-time compare. 48 chars over the config-key space is computationally infeasible; the network+DB latency (~0.4s/attempt) is itself the practical throttle. Length oracle from the early-return is NOT observable over the network (2.7). | Proven (arith) | Medium |
| **A-7** | 3 | Webhook DB-amplification | CAP 10 | read-before-verify | **Confirmed by source + 2.9:** `square-webhook` reads the full `app_config` (`select key,value`) at :38 **before** the signature check at :56; `stripe-webhook` reads its one key at :37 before verify at :44. An unsigned flood forces one `app_config` SELECT each. Live: both return 503 (secret unset) after that read. | Confirmed | Medium |

**A-5 and A-6 executed cleanly in the inert window and both confirmed their
findings.** A-1/A-2/A-3 are deferred because they are genuinely inert until
Stripe/Resend are configured — running them now proves nothing; they belong in the
go-live shakedown (off-hours, capped). A-4/A-7 are settled by analysis + the
existing live data rather than a flood.

---

# PHASE 5 — Non-technical findings (Tier 0)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| NT-1 | **High** | **No privacy policy, no terms, no retention limit, no deletion path**, while `notes` is prompted for dietary info ("No onions, extra garlic sauce…") and will collect allergy/health data. Old site had `terms-and-policies`; new site has none (grep of 5 HTML files = 0 privacy links). Regime: **Florida Digital Bill of Rights** + PCI-DSS (not GDPR — FL restaurant, US pickup customers, no territorial nexus). | order.html:86; §14 |
| NT-2 | **Medium** | **PCI-DSS SAQ A tamper-protection requirement unmet.** SAQ A (correct scope for full-redirect hosted checkout) requires the redirecting page be protected from tampering. There is **no CSP** (2.12) and **unversioned Google Fonts with no SRI** (P1D-5) on `order.html` — the page that builds the cart and initiates checkout. Both are the specific weaknesses an SAQ-A assessor flags. | 2.12; P1D-5 |
| NT-3 | **High** | **No audit trail** on cancellations, price changes, or refunds. `orders` has only mutable `status`+`updated_at`; no `order_events`, no actor (staff share one key), no reason. "I paid, you cancelled" is unreconstructable. | §22; P0-SCH |
| NT-4 | **High** | **Refunds live entirely outside the system**, and the KDS refund deep-link is gated on `stripe_payment_intent` — never populated on the Square path (Square writes `provider_payment_id`). With Square live, staff get a cancel button and **no refund path**. | kitchen.js:487; square-webhook:86 |
| NT-5 | **Medium** | **Health check is daily** (`lilys-health-check`, 15:30 UK); a payment/webhook outage can run ~24h undetected. `reconcile` is Stripe-only and inert on the chosen Square path. | §22; reconcile:19 |
| NT-6 | **Medium** | **Secrets in a DB table, not a secret manager**, loaded wholesale (`select key,value` — entire `app_config`) into `create-checkout`'s memory on every request. Only `stripe-webhook` scopes to one key. | create-checkout:70; §19 |
| NT-7 | **Medium** | **INFO-1 (from 2.15):** full Edge Function source + operational runbook served publicly on GitHub Pages. The runbook leaks the exact `app_config` key names and go-live SQL. | 2.15 |
| NT-8 | **High (latent)** | **P0-GRANT-1:** anon/authenticated hold INSERT/UPDATE/DELETE/TRUNCATE on all three tables; only the (policy-less) RLS stops them. One permissive policy or one `disable row level security` = immediate anon data breach + destruction. | P0-GRANT-1 |
| NT-9 | **Critical (go-live design)** | **KDS demo/real ticket distinguishability.** Demo tickets carry only a small `test` badge (kitchen.js:301,334). Today that's harmless — every order is demo and nobody watches the board. **The risk is post-launch:** if a partial Square config silently reverts to demo (the M-1 trap), those free `$0` orders land on the *live* kitchen board looking like ordinary tickets bar one small badge. Staff either make free food or ignore a "test" that a real hungry customer placed. Mitigation is the go-live gate (all-three check + one real `demo=false` order) — see `GO_LIVE_CHECKLIST.md`. Not a "someone sees a demo ticket now" problem; a "demo and real become confusable the instant the site is live" problem. | M-1; kitchen.js:301,334 |

---

# Corrections & changes to SYSTEM_PROFILE.md

Live testing changed or resolved several profile claims:

1. **RLS (Top-10 #2, Blocking Unknown #1) — RESOLVED, not a breach.** RLS is
   enabled on `orders`/`app_config` with **zero policies** → deny-all. Anon reads
   return `[]` (P0-RLS-4, 2.1, 2.2a). The profile's "one HTTP call from total
   breach or total non-event" resolves to **non-event** — *today*. The residual is
   NT-8: the wide anon DML grants make it fragile.

2. **`verify_jwt` (Top-10 #7, §4/§6) — profile was wrong on three functions.**
   `notify-order`, `reconcile`, `daily-summary` are **`verify_jwt=true`**, not
   unauthenticated. No-auth → 401 (2.4). They need the public anon key. Top-10 #7
   (daily-summary) downgrades from "completely unauthenticated" to "anon-key-gated
   and currently inert (Resend off)."

3. **Demo mode (Top-10 #1) — CONFIRMED live at config level.** `payment_provider=
   square` with all Square creds empty and no Stripe keys → the system is in demo
   mode now; every order would insert `status:"paid"` uncharged (P0-CFG, P1A-2
   truth table). Only the end-to-end write test (M-1) remains, pending approval.

4. **esc() quote-leaking count (§16) — four, not three.** Measured: `order.js`,
   `chat.js`, `notify-order`, `daily-summary` all leave quotes raw; only
   `kitchen.js:41` escapes them (P1B-6). Minor, but the profile's "three of five"
   is off by one.

5. **New: INFO-1 / NT-7 — Edge Function source is public.** GitHub Pages serves
   `supabase/functions/**` (2.15). Not in the profile.

6. **New: NT-8 — wide anon table grants.** INSERT/UPDATE/DELETE/TRUNCATE granted
   to `anon`; profile assumed RLS was the whole story. The grants are the latent
   half.

7. **WAF (profile §3 "UNVERIFIED") — Cloudflare is present** in front of the
   functions; a SQL-metacharacter payload returned a Cloudflare block page (2.6e),
   not a function 500. Some edge filtering exists.

8. **Square path is doubly dormant.** `square_webhook_signature_key` is unset →
   `square-webhook` returns 503 (2.9). Combined with demo mode, the entire Square
   flow is non-functional today; M-5/M-6 real-provider tests are blocked until
   go-live.

9. **Price drift (Top-10 #9) — clean today.** All 62 items: display (`data.js`+3%)
   == charge (`menu_items`) exactly (M-4). The *process* risk (manual sync)
   stands; the current *state* is correct.

10. **`notify_order_paid` SECURITY DEFINER advisor — not exploitable.** Flagged by
    the linter as anon-executable, but live RPC call returns PGRST202 (trigger
    signature, not RPC-exposed) (2.2c).

**Re-ranked, evidence-based Top findings after live testing:**

1. **Demo mode active** — confirmed at config (Critical; M-1 to close).
2. **Anon DML grants behind policy-less RLS** — NT-8, one line from breach (High).
3. **No CSP / SAQ-A tamper gap** on the checkout page — NT-2 (Medium, but PCI-relevant).
4. **Edge Function source public** — INFO-1 (Medium force-multiplier).
5. **Square go-live cliff** — M-5 orphaned link + no reconcile + no refund path, all
   waiting to bite the moment credentials are added (Critical-on-go-live).
6. **No audit trail / refund-outside-system** — NT-3, NT-4 (High operational).

The profile's #2 (RLS breach) and #7 (unauthenticated daily-summary) are **down**;
#1 (demo mode) is **confirmed and up**; a new infra finding (public source) is
**in**.
