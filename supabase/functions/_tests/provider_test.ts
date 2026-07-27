/* The provider/demo/refuse decision in create-checkout — the gate that decides
 * whether the site is live, demo, or refusing. Pinned after the 2026-07-28
 * readiness-gate fix (SECURITY.md M-1/M-2): the two silent half-configured
 * failures must both refuse loudly instead of pretending.
 *
 * Tier 0 — inert. Pure function via mirrors.ts; no network, no database.
 */
import { assertEquals } from "jsr:@std/assert@1";
import { decideProvider } from "./mirrors.ts";

const T = "sq0atp-token", L = "LOCATION123", S = "sigkey123", K = "sk_test_key";

type Case = {
  name: string;
  in: { wanted: string; squareToken: string; squareLocation: string; squareSigKey: string; stripeKey: string };
  out: { provider: "" | "square" | "stripe"; demo: boolean; refused503: boolean; status: string };
};

const CASES: Case[] = [
  // ── fully configured, named — the intended Wednesday end-state ──────────
  {
    name: "square named, all three values → live square, orders pending",
    in: { wanted: "square", squareToken: T, squareLocation: L, squareSigKey: S, stripeKey: "" },
    out: { provider: "square", demo: false, refused503: false, status: "pending" },
  },
  {
    name: "stripe named, key present → live stripe, orders pending",
    in: { wanted: "stripe", squareToken: "", squareLocation: "", squareSigKey: "", stripeKey: K },
    out: { provider: "stripe", demo: false, refused503: false, status: "pending" },
  },

  // ── M-1: the charge-cards-but-lose-orders state must now refuse ─────────
  {
    name: "square named, signature key missing (M-1) → REFUSED, never live",
    in: { wanted: "square", squareToken: T, squareLocation: L, squareSigKey: "", stripeKey: "" },
    out: { provider: "", demo: false, refused503: true, status: "n/a — request refused" },
  },

  // ── M-2: the free-food states must refuse, not fall back to demo ────────
  {
    name: "square named, location missing (M-2 trace) → REFUSED, not demo",
    in: { wanted: "square", squareToken: T, squareLocation: "", squareSigKey: S, stripeKey: "" },
    out: { provider: "", demo: false, refused503: true, status: "n/a — request refused" },
  },
  {
    name: "square named, token only → REFUSED",
    in: { wanted: "square", squareToken: T, squareLocation: "", squareSigKey: "", stripeKey: "" },
    out: { provider: "", demo: false, refused503: true, status: "n/a — request refused" },
  },
  {
    name: "square named, nothing pasted yet → REFUSED (was: silent demo)",
    in: { wanted: "square", squareToken: "", squareLocation: "", squareSigKey: "", stripeKey: "" },
    out: { provider: "", demo: false, refused503: true, status: "n/a — request refused" },
  },
  {
    name: "square named, only stripe key present → REFUSED (never the wrong processor)",
    in: { wanted: "square", squareToken: "", squareLocation: "", squareSigKey: "", stripeKey: K },
    out: { provider: "", demo: false, refused503: true, status: "n/a — request refused" },
  },
  {
    name: "stripe named, key missing → REFUSED",
    in: { wanted: "stripe", squareToken: "", squareLocation: "", squareSigKey: "", stripeKey: "" },
    out: { provider: "", demo: false, refused503: true, status: "n/a — request refused" },
  },
  {
    name: "unknown provider name (typo), even fully configured → REFUSED, no guessing",
    in: { wanted: "sqaure", squareToken: T, squareLocation: L, squareSigKey: S, stripeKey: K },
    out: { provider: "", demo: false, refused503: true, status: "n/a — request refused" },
  },

  // ── demo mode: only when nobody asked for a provider at all ─────────────
  {
    name: "nothing named, nothing configured → demo, orders paid immediately",
    in: { wanted: "", squareToken: "", squareLocation: "", squareSigKey: "", stripeKey: "" },
    out: { provider: "", demo: true, refused503: false, status: "paid" },
  },
  {
    name: "nothing named, full square config → implicit square activation (preserved)",
    in: { wanted: "", squareToken: T, squareLocation: L, squareSigKey: S, stripeKey: "" },
    out: { provider: "square", demo: false, refused503: false, status: "pending" },
  },
  {
    name: "nothing named, stripe key → implicit stripe activation (preserved)",
    in: { wanted: "", squareToken: "", squareLocation: "", squareSigKey: "", stripeKey: K },
    out: { provider: "stripe", demo: false, refused503: false, status: "pending" },
  },
  // Residual, documented on purpose: with NO provider named, a partial square
  // paste falls to demo (free-food direction), which go-live Step 3 catches via
  // the [TEST] email heartbeat. It can no longer reach the M-1 direction,
  // because implicit activation also requires all three values now.
  {
    name: "nothing named, square two-of-three → demo, NOT live (documented residual)",
    in: { wanted: "", squareToken: T, squareLocation: L, squareSigKey: "", stripeKey: "" },
    out: { provider: "", demo: true, refused503: false, status: "paid" },
  },
];

for (const c of CASES) {
  Deno.test(`provider gate: ${c.name}`, () => {
    const got = decideProvider(c.in);
    assertEquals(
      { provider: got.provider, demo: got.demo, refused503: got.refused503, status: got.status },
      c.out,
    );
  });
}

Deno.test("provider gate: whitespace/case in payment_provider is normalised", () => {
  const got = decideProvider({ wanted: "  Square  ", squareToken: T, squareLocation: L, squareSigKey: S, stripeKey: "" });
  assertEquals(got.provider, "square");
  assertEquals(got.refused503, false);
});
