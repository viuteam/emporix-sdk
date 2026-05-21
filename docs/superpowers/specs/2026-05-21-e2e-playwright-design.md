# E2E Tests with `@playwright/test` + Playwright Agent CLI — Design

## Context

The SDK and React packages have **213 unit tests** (143 SDK + 70 React) covering hook contracts and service-layer behavior, all running against MSW-mocked HTTP. There is **no automated end-to-end coverage** that:

1. Renders the `examples/vite-spa` app in a real browser.
2. Talks to the real `viu` Emporix tenant.
3. Verifies that user-visible flows (catalog, login, guest checkout, customer-cart onboarding) actually work — including details that MSW cannot model: the live `saasToken` / `refreshToken` shapes, the real `sessionId` lifecycle, the `GET /carts?siteCode=…` server response with `create=true`, real cart-merge mechanics.

Today we verify these manually via Chrome DevTools MCP — reproducible only as long as someone (Claude) is at the keyboard. Two recent PRs (#26 Customer-Cart Onboarding, #25 Pagination Harmonize) shipped without automated live verification.

This change adds an **E2E layer** combining two Playwright tools:

- **`@playwright/test`** as the canonical test format (`e2e/*.spec.ts`), runnable in CI.
- **Playwright Agent CLI** (`playwright install --skills` + `playwright-cli` shell commands) as Claude's interactive authoring tool — the agent-friendly alternative to `playwright codegen`. Spec files in the repo are the source of truth; the Agent CLI is the development workflow.

## Goals

- Reproducible E2E suite covering the four critical user flows of the `vite-spa` Example:
  1. Anonymous catalog renders (no login needed).
  2. Customer login + `me` query resolves the profile.
  3. Guest checkout end-to-end → real order placed (`EONxxxx`).
  4. Guest cart → login → cart merge into customer cart.
- Tests run locally with `pnpm e2e` against a fresh dev server.
- CI workflow `e2e.yml` runs the suite on `workflow_dispatch` initially (manual trigger). PR/push gating is **deferred** until the suite is stable for at least one week.
- Tests that need customer credentials **skip cleanly** without `EMPORIX_TEST_CUSTOMER_EMAIL` / `_PASSWORD` env vars. Anonymous-only specs run in any environment.
- Claude can develop and debug specs using the Playwright Agent CLI as an interactive shell, observing accessibility snapshots after each step instead of Chrome DevTools MCP.

## Non-Goals

- Replace the unit-test suite. Unit tests stay primary; E2E is complementary smoke.
- Test the SDK package directly. E2E goes through the React example — that's the realistic consumer path. The SDK's contract is fully covered by its unit tests + integration via the Example.
- Cover every hook or every edge case. Smoke = happy paths only.
- Test the `next-app-router` Example in this iteration. It needs a different harness (SSR rendering, server actions); separate plan when prioritized.
- Test the `node-server` Example. It's a non-React script; covered well enough by its own runtime smoke.
- Force-gate CI on E2E from day 1 — proven stable first, then promoted.

## Architecture

### Workspace layout

```
emporix-sdk/
├── e2e/                                        ← new top-level package
│   ├── package.json                            ← @viu/emporix-e2e, devDeps: @playwright/test
│   ├── playwright.config.ts                    ← single project; baseURL=http://localhost:5173
│   ├── tsconfig.json                           ← extends ../tsconfig.base.json
│   ├── fixtures/
│   │   └── test-customer.ts                    ← env-driven test-customer; skip helper
│   └── specs/
│       ├── catalog.spec.ts                     ← anonymous Product list + Categories
│       ├── customer-session.spec.ts            ← login + me + logout
│       ├── guest-checkout.spec.ts              ← cart-create → addItem → placeOrder
│       └── customer-cart-onboarding.spec.ts    ← guest cart → login → merge
├── packages/                                   ← unchanged
└── examples/                                   ← unchanged (the test target)
```

### `playwright.config.ts`

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  fullyParallel: false, // tests share storage; run sequentially for safety
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Start the vite-spa dev server before the suite; reuse if already running.
    command: "pnpm -F @viu/emporix-examples-vite-spa dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_EMPORIX_TENANT: "viu",
      VITE_EMPORIX_STOREFRONT_CLIENT_ID:
        process.env.VITE_EMPORIX_STOREFRONT_CLIENT_ID ??
        "miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO",
    },
  },
});
```

### Test customer fixture

```typescript
// e2e/fixtures/test-customer.ts
import { test as base, expect } from "@playwright/test";

interface Creds { email: string; password: string }

function readCreds(): Creds | null {
  const email = process.env.EMPORIX_TEST_CUSTOMER_EMAIL;
  const password = process.env.EMPORIX_TEST_CUSTOMER_PASSWORD;
  return email && password ? { email, password } : null;
}

export const test = base.extend<{ customer: Creds }>({
  customer: async ({}, use) => {
    const creds = readCreds();
    test.skip(!creds, "EMPORIX_TEST_CUSTOMER_EMAIL/_PASSWORD not set; skipping login-bound test");
    await use(creds!);
  },
});

export { expect };
```

Tests that **only** need anonymous browsing import from `@playwright/test` directly. Tests that need the logged-in path import from `./fixtures/test-customer` — that fixture is the skip gate.

### Spec patterns (high-level only — full code is in the plan)

| Spec | Customer creds needed? | Network expectations |
|---|---|---|
| `catalog.spec.ts` | No | `GET /product/viu/products?pageSize=12` → renders 12 product names |
| `customer-session.spec.ts` | Yes | `POST /customer/viu/login` → `GET /customer/viu/me` → `me.contactEmail === creds.email` |
| `guest-checkout.spec.ts` | No | `POST /cart/viu/carts` (201) → `POST /price/viu/match-…` → `POST /cart/.../items` → `POST /checkout/.../order` (200, returns `orderId`) |
| `customer-cart-onboarding.spec.ts` | Yes | Guest cart created → login → `GET /cart/viu/carts?siteCode=main&create=true` → `POST /merge` → `localStorage.emporix.cartId` is the customer cart |

Each spec asserts:
1. The user-visible outcome (text in the DOM).
2. The right Emporix HTTP calls happened (via `page.route` listening or `page.on('request')`).
3. Storage state (`localStorage` keys we own).

### Agent CLI integration

The Agent CLI is **not part of the runtime test infrastructure** — it is Claude's authoring tool during plan execution. Concretely:

- `playwright install --skills` lays down agent-friendly browser capabilities.
- Claude uses `playwright-cli open http://localhost:5173/guest`, `playwright-cli snapshot`, `playwright-cli click <uid>` etc. to explore each scenario interactively while writing the spec.
- The accessibility snapshot returned by `playwright-cli snapshot` informs the `page.getByRole(...)` / `page.locator(...)` selectors that go into the `.spec.ts` file.
- Once the spec is committed, the test runner is `@playwright/test`, not the Agent CLI.

This is the same pattern as `playwright codegen`, just optimized for agent loops (concise output, no big DOM dumps).

### Skips and credentials

| Env var | Required for | Set by |
|---|---|---|
| `VITE_EMPORIX_TENANT` (set in `webServer.env`) | always | playwright.config.ts default `viu` |
| `VITE_EMPORIX_STOREFRONT_CLIENT_ID` | always | playwright.config.ts default (viu storefront id) |
| `EMPORIX_TEST_CUSTOMER_EMAIL` | login-bound specs | developer locally, GitHub Actions secret in CI |
| `EMPORIX_TEST_CUSTOMER_PASSWORD` | login-bound specs | same |

A test customer must exist on the `viu` tenant. Creating one is a one-off task documented in the plan; the credentials go to `.env.local` (gitignored) and to GitHub Actions secrets.

### CI workflow

```yaml
# .github/workflows/e2e.yml — created in the plan
name: E2E
on:
  workflow_dispatch:
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - checkout
      - setup-node + pnpm
      - pnpm install --frozen-lockfile
      - pnpm -F @viu/emporix-sdk build
      - pnpm -F @viu/emporix-sdk-react build
      - pnpm -F @viu/emporix-e2e exec playwright install --with-deps chromium
      - pnpm e2e
        env:
          EMPORIX_TEST_CUSTOMER_EMAIL: ${{ secrets.EMPORIX_TEST_CUSTOMER_EMAIL }}
          EMPORIX_TEST_CUSTOMER_PASSWORD: ${{ secrets.EMPORIX_TEST_CUSTOMER_PASSWORD }}
      - upload-artifact: playwright-report (on failure)
```

`workflow_dispatch` only at first. After two weeks of stable green runs, promote to `pull_request` trigger.

### Workspace wiring

`pnpm-workspace.yaml` already lists `packages/*` and `examples/*`. Add `e2e` as a new package:

```yaml
packages:
  - "packages/*"
  - "examples/*"
  - "e2e"
```

Root `package.json` gets a script:

```json
"scripts": {
  "e2e": "pnpm --filter @viu/emporix-e2e exec playwright test"
}
```

## Data Flow

A typical run of `guest-checkout.spec.ts`:

```
$ pnpm e2e
  ↓
playwright.config.ts: webServer starts → pnpm -F @viu/emporix-examples-vite-spa dev
  ↓ (vite ready on :5173)
chromium opens http://localhost:5173/guest
  ↓ page.goto, page.getByRole('button', { name: 'Start guest cart' }).click()
  ↓
[Real Emporix calls fire]
GET  /customerlogin/auth/anonymous/login    → 200 (anonymous session)
POST /cart/viu/carts                         → 201 (cart-A)
POST /price/viu/match-prices-by-context      → 200
POST /cart/viu/carts/cart-A/items            → 201
  ↓ page.getByText(/Cart: /) visible
  ↓ page.getByRole('button', { name: 'Place guest order' }).click()
POST /price/viu/match-prices-by-context      → 200
POST /checkout/viu/checkouts/order           → 200 (orderId)
  ↓ page.getByText(/Order placed: EON/) visible
  ↓ test asserts: orderId.startsWith("EON")
  ↓ test asserts: localStorage.emporix.cartId === null (cleared after order)
```

The test passes if all DOM, network, and storage assertions hold.

## Testing

### Self-test on first introduction

The very first spec to land (`catalog.spec.ts`) acts as the smoke test for the framework itself: if it passes, the harness is wired correctly. Subsequent specs build on the same harness.

### Manual verification per spec while writing

For each spec, Claude uses the Agent CLI to drive the same scenario by hand first, captures the resulting selectors and assertions, then writes the spec. Specs without a prior interactive walkthrough are rejected.

### CI dry-run before merge

Before merging the E2E branch, the workflow is triggered manually (`gh workflow run e2e.yml`) and must pass against the real `viu` tenant. A single dry-run is enough — the suite is small.

## Risk / Compatibility

| Concern | Likelihood | Mitigation |
|---|---|---|
| Flaky tests due to live Emporix | Medium | `retries: 2` in CI; `retain-on-failure` traces; bound timeouts at 30 s |
| Test customer pollutes `viu` with orders | Certain | Orders are intentional; `viu` is a test/internal tenant. Document as such in the spec. |
| Credentials leak via screenshots | Low | Mask password input via `page.fill(…, password)` (Playwright redacts in traces by default); `screenshot: "only-on-failure"` minimizes capture |
| CI cold start (Chromium download) | Always | Cache `~/.cache/ms-playwright`; first run ~3 min, subsequent ~30 s |
| Suite stale as Examples evolve | Medium | Specs target high-stability selectors (`getByRole`, visible text); accept that example UI changes require spec updates |
| Examples need rebuild after SDK changes | Yes | CI does `pnpm -F @viu/emporix-sdk build` + react before e2e; locally `pnpm e2e` documents this prereq |

**Changeset:** None — this is a new dev-tool package, not a published artifact. No version bump.

## File Structure

| File | Change |
|---|---|
| `e2e/package.json` | **CREATE** — `@viu/emporix-e2e` private, devDeps `@playwright/test` |
| `e2e/playwright.config.ts` | **CREATE** |
| `e2e/tsconfig.json` | **CREATE** |
| `e2e/fixtures/test-customer.ts` | **CREATE** — `test` fixture with skip-on-missing-creds |
| `e2e/specs/catalog.spec.ts` | **CREATE** |
| `e2e/specs/customer-session.spec.ts` | **CREATE** |
| `e2e/specs/guest-checkout.spec.ts` | **CREATE** |
| `e2e/specs/customer-cart-onboarding.spec.ts` | **CREATE** |
| `pnpm-workspace.yaml` | Add `e2e` to packages list |
| `package.json` (root) | Add `e2e` script |
| `.github/workflows/e2e.yml` | **CREATE** — manual-trigger first |
| `.gitignore` | Append `e2e/.env.local`, `e2e/playwright-report`, `e2e/test-results` |
| `docs/e2e.md` | **CREATE** — how to run locally, how to set creds, how Claude uses the Agent CLI to author specs |

## Out-of-scope follow-ups

- `next-app-router` E2E coverage — SSR-specific harness; separate plan.
- Cross-browser matrix (firefox/webkit) — add when chromium stabilizes.
- Performance budgets (LCP, INP) via Lighthouse — orthogonal concern.
- Visual regression tests — Playwright supports it; add when there's a designer/QA who owns the baselines.
- Promote E2E to `pull_request` trigger — only after two weeks of stable green runs.
- Multi-tenant E2E — viu only for now; abstract if/when needed.
