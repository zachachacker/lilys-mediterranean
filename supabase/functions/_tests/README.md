# Security test suite

Deno unit tests for the pure logic inside the Edge Functions, written for the
security assessment (see `../../../SECURITY_TEST_PLAN.md`). **Tier 0 — inert.**
No network, no database, no production mutation.

```bash
deno test --allow-read supabase/functions/_tests/
```

- `mirrors.ts` — byte-for-byte (or faithfully transcribed) copies of the pure
  functions from the real handlers, so they can be tested without starting the
  `Deno.serve` server. Every export cites its source `file:line`.
- `drift_test.ts` — re-reads the real source files and asserts the mirrors still
  match. If a handler is edited without updating a mirror, these fail. Run these
  first; the rest are only meaningful while they pass.
- `signature_test.ts` — Stripe + Square webhook signature verification, the sole
  auth on both webhook endpoints.
- `transitions_test.ts` — all 36 order-status transitions.
- `validation_test.ts` — `create-checkout` input validation + the demo-mode
  provider-selection truth table.
- `provider_test.ts` — named scenarios for the readiness gate (SECURITY.md
  M-1/M-2, fixed 2026-07-28): named-but-unconfigured providers refuse with 503;
  demo mode only when no provider is named.
- `escaping_test.ts` — the five `esc()` variants and `telHref()`.

`--allow-read` only. No `--allow-net`, no `--allow-env`, no `--allow-write`.
