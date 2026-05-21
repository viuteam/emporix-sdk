# E2E Tests with `@playwright/test` + Playwright Agent CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `e2e/` workspace package running 4 `@playwright/test` specs against the `vite-spa` Example connected to the live `viu` tenant (catalog, customer-session, guest-checkout, customer-cart-onboarding). The Playwright Agent CLI (`playwright install --skills`, `playwright-cli` shell commands) is the agent-authoring tool during spec development; the committed `.spec.ts` files are the runtime contract.

**Architecture:** New `e2e/` package alongside `packages/` and `examples/`. Single `playwright.config.ts` with the vite-spa dev server as `webServer`. A `test-customer` fixture skips login-bound specs when credentials are absent. CI workflow runs on `workflow_dispatch` initially.

**Tech Stack:** `@playwright/test`, Chromium (only browser initially), Playwright Agent CLI for authoring, pnpm workspaces, GitHub Actions, commitlint with scope-enum.

**Context for the engineer:**

- Read the spec first: `docs/superpowers/specs/2026-05-21-e2e-playwright-design.md`.
- Branch: `feat/e2e-playwright` (already created off `main`).
- Commitlint allowed scopes include `examples` and `repo`; use `feat(examples): add e2e package` etc. Lowercase first word.
- The Playwright Agent CLI is **Claude's authoring tool**, not part of the committed test code. During spec implementation (Tasks 5–8), Claude is expected to launch the Agent CLI, walk through each scenario interactively, observe accessibility snapshots, capture the resulting selectors into the `.spec.ts` file, and then close the CLI session before committing. The committed code uses `@playwright/test` only.
- `viu` is a test/internal tenant. Orders placed by `guest-checkout.spec.ts` are intentional artifacts.

---

## File Structure

| File | Responsibility |
|---|---|
| `e2e/package.json` | Workspace package, devDeps on `@playwright/test`, scripts `test` + `test:headed` |
| `e2e/playwright.config.ts` | Single chromium project, webServer auto-starts vite-spa, env defaults for `viu` |
| `e2e/tsconfig.json` | Extends `../tsconfig.base.json`, includes `specs/` and `fixtures/` |
| `e2e/fixtures/test-customer.ts` | `test` fixture with skip-on-missing-creds |
| `e2e/specs/catalog.spec.ts` | Anonymous catalog page renders products |
| `e2e/specs/customer-session.spec.ts` | login + me + logout (skips without creds) |
| `e2e/specs/guest-checkout.spec.ts` | Cart create → addItem → placeOrder → orderId |
| `e2e/specs/customer-cart-onboarding.spec.ts` | Guest cart → login → merge → cartId persisted |
| `pnpm-workspace.yaml` | Add `e2e` to packages list |
| `package.json` (root) | Add `e2e` and `e2e:headed` scripts |
| `.github/workflows/e2e.yml` | Manual-trigger workflow |
| `.gitignore` | `e2e/.env.local`, `e2e/playwright-report`, `e2e/test-results` |
| `docs/e2e.md` | How to run, how to set creds, Agent CLI authoring workflow |

---

## Task 1: Scaffold the `e2e` workspace package

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/tsconfig.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (root)
- Modify: `.gitignore`

- [ ] **Step 1: Add `e2e` to the workspace**

In `pnpm-workspace.yaml`, append `- "e2e"` to the existing `packages:` list.

- [ ] **Step 2: Create `e2e/package.json`**

```json
{
  "name": "@viu/emporix-e2e",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "typescript": "^5.9.3"
  }
}
```

Pick a `@playwright/test` version that matches what the repo currently uses (or the latest 1.x); the example above is a reasonable default at the time of writing.

- [ ] **Step 3: Create `e2e/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["specs/**/*.ts", "fixtures/**/*.ts", "playwright.config.ts"]
}
```

- [ ] **Step 4: Add root scripts**

Edit `package.json` (root) — locate the `"scripts": { … }` block and add:

```json
"e2e": "pnpm --filter @viu/emporix-e2e exec playwright test",
"e2e:headed": "pnpm --filter @viu/emporix-e2e exec playwright test --headed"
```

- [ ] **Step 5: Update `.gitignore`**

Append:

```
# e2e
e2e/.env.local
e2e/playwright-report/
e2e/test-results/
e2e/node_modules/.cache
```

- [ ] **Step 6: Install dependencies**

```bash
pnpm install
```

Expected: pnpm picks up the new `e2e` package, installs `@playwright/test`.

- [ ] **Step 7: Install Chromium**

```bash
pnpm --filter @viu/emporix-e2e exec playwright install chromium
```

Expected: Chromium binary downloaded (~250 MB; cached at `~/.cache/ms-playwright`).

- [ ] **Step 8: Commit**

```bash
git add e2e/ pnpm-workspace.yaml package.json .gitignore pnpm-lock.yaml
git commit -m "chore(examples): scaffold e2e workspace with playwright"
```

---

## Task 2: Create `playwright.config.ts`

**Files:**
- Create: `e2e/playwright.config.ts`

- [ ] **Step 1: Write the config**

```typescript
import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm -F @viu/emporix-examples-vite-spa dev --port " + PORT,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_EMPORIX_TENANT: process.env.VITE_EMPORIX_TENANT ?? "viu",
      VITE_EMPORIX_STOREFRONT_CLIENT_ID:
        process.env.VITE_EMPORIX_STOREFRONT_CLIENT_ID ??
        "miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO",
    },
  },
});
```

- [ ] **Step 2: Verify Playwright recognizes the config**

```bash
pnpm --filter @viu/emporix-e2e exec playwright test --list
```

Expected: lists 0 tests (no spec files yet) but does not error. Confirms the config is valid.

- [ ] **Step 3: Commit**

```bash
git add e2e/playwright.config.ts
git commit -m "chore(examples): e2e playwright config with viu defaults"
```

---

## Task 3: Test-customer fixture

**Files:**
- Create: `e2e/fixtures/test-customer.ts`

- [ ] **Step 1: Write the fixture**

```typescript
import { test as base, expect } from "@playwright/test";

interface Creds {
  email: string;
  password: string;
}

function readCreds(): Creds | null {
  const email = process.env.EMPORIX_TEST_CUSTOMER_EMAIL;
  const password = process.env.EMPORIX_TEST_CUSTOMER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Test fixture that exposes the test customer's credentials. Reads from
 * `EMPORIX_TEST_CUSTOMER_EMAIL` and `EMPORIX_TEST_CUSTOMER_PASSWORD`.
 * Tests using `customer` are skipped (not failed) when the env vars are
 * unset — keeps the suite green for contributors without viu access.
 */
export const test = base.extend<{ customer: Creds }>({
  customer: async ({}, use) => {
    const creds = readCreds();
    test.skip(!creds, "EMPORIX_TEST_CUSTOMER_EMAIL/_PASSWORD not set");
    await use(creds as Creds);
  },
});

export { expect };
```

- [ ] **Step 2: Commit**

```bash
git add e2e/fixtures/test-customer.ts
git commit -m "test(examples): test-customer fixture skips without creds"
```

---

## Task 4: Smoke spec — `catalog.spec.ts`

**Files:**
- Create: `e2e/specs/catalog.spec.ts`

- [ ] **Step 1: Author the spec with Agent CLI walkthrough**

Open a separate terminal and run:

```bash
pnpm -F @viu/emporix-examples-vite-spa dev
```

In another terminal, drive the page through the Playwright Agent CLI to capture the right selectors:

```bash
playwright-cli open http://localhost:5173/
playwright-cli snapshot
# Observe the accessibility tree → product items have role="listitem"
playwright-cli close
```

Use those observations to write the spec at `e2e/specs/catalog.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test("anonymous catalog renders 12 products", async ({ page }) => {
  await page.goto("/");
  // Allow the anonymous-login + product-list calls to settle.
  await expect(page.locator("ul li")).toHaveCount(12, { timeout: 15_000 });
});

test("the anonymous login + product list are the only Emporix calls on /", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("api.emporix.io")) calls.push(req.method() + " " + new URL(url).pathname);
  });
  await page.goto("/");
  await expect(page.locator("ul li")).toHaveCount(12, { timeout: 15_000 });
  // Filter OPTIONS preflights; we care about real requests.
  const real = calls.filter((c) => !c.startsWith("OPTIONS"));
  expect(real).toEqual([
    "GET /customerlogin/auth/anonymous/login",
    "GET /product/viu/products",
  ]);
});
```

- [ ] **Step 2: Run the spec**

```bash
pnpm -F @viu/emporix-e2e exec playwright test specs/catalog.spec.ts
```

Expected: 2 tests pass. If the product list count differs on viu (catalog can change), update the expected number — but the count should be exactly 12 because the App uses `useProducts({ pageSize: 12 })`.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/catalog.spec.ts
git commit -m "test(examples): e2e catalog spec — anonymous product list"
```

---

## Task 5: Customer-session spec — `customer-session.spec.ts`

**Files:**
- Create: `e2e/specs/customer-session.spec.ts`

- [ ] **Step 1: Confirm credentials are configured locally**

Create `e2e/.env.local` (gitignored by Task 1):

```
EMPORIX_TEST_CUSTOMER_EMAIL=<your-test-email>
EMPORIX_TEST_CUSTOMER_PASSWORD=<your-test-password>
```

Export them in the shell before running Playwright, e.g. via:

```bash
set -a; source e2e/.env.local; set +a
```

If you don't have a test customer on the `viu` tenant, create one via the Management Dashboard or `POST /customer/viu/signup` first.

- [ ] **Step 2: Walk through the scenario via Agent CLI**

```bash
playwright-cli open http://localhost:5173/account
playwright-cli snapshot
# Observe the form: two textboxes (email + password), one button "Log in"
playwright-cli fill <email-uid> "<test-email>"
playwright-cli fill <password-uid> "<test-password>"
playwright-cli click <login-button-uid>
playwright-cli snapshot
# Should now show "Signed in as <email>"
playwright-cli close
```

- [ ] **Step 3: Write the spec**

```typescript
import { test, expect } from "../fixtures/test-customer";

test("login resolves the customer profile and shows the email", async ({ page, customer }) => {
  await page.goto("/account");
  await page.getByPlaceholder("email").fill(customer.email);
  await page.getByPlaceholder("password").fill(customer.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(new RegExp(`Signed in as ${escapeRegExp(customer.email)}`))).toBeVisible({
    timeout: 15_000,
  });
  // Customer token must end up in localStorage.
  const stored = await page.evaluate(() => localStorage.getItem("emporix.customerToken"));
  expect(stored).not.toBeNull();
});

test("logout clears the customer token", async ({ page, customer }) => {
  await page.goto("/account");
  await page.getByPlaceholder("email").fill(customer.email);
  await page.getByPlaceholder("password").fill(customer.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByPlaceholder("email")).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem("emporix.customerToken"));
  expect(stored).toBeNull();
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run**

```bash
pnpm -F @viu/emporix-e2e exec playwright test specs/customer-session.spec.ts
```

Expected: 2 tests pass with credentials set, both skip cleanly when env vars are absent.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/customer-session.spec.ts
git commit -m "test(examples): e2e customer-session spec — login and logout"
```

---

## Task 6: Guest-checkout spec — `guest-checkout.spec.ts`

**Files:**
- Create: `e2e/specs/guest-checkout.spec.ts`

- [ ] **Step 1: Walk through via Agent CLI**

```bash
playwright-cli open http://localhost:5173/guest
playwright-cli evaluate "() => localStorage.clear()"
playwright-cli reload
playwright-cli click <start-button-uid>
playwright-cli snapshot
# Should now show: Cart: <id>, Unit price: 1
playwright-cli click <add-sample-item-uid>
playwright-cli reload   # cart query refetch — known UX quirk
playwright-cli click <place-order-uid>
playwright-cli snapshot
# Should show: Order placed: EON<digits>
playwright-cli close
```

- [ ] **Step 2: Write the spec**

```typescript
import { test, expect } from "@playwright/test";

test("guest places an order end-to-end", async ({ page }) => {
  await page.goto("/guest");
  // Fresh start — no carry-over cart from a previous run.
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "Start guest cart" }).click();
  await expect(page.getByText(/^Cart: /)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Unit price:/)).toBeVisible();

  await page.getByRole("button", { name: "Add sample item" }).click();
  // The existing useCartMutations.addItem updates the cache asynchronously;
  // reloading is the simplest reliable way to observe the new item count.
  await page.reload();
  await expect(page.getByText(/Cart:.*\(1 item\(s\)\)/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Place guest order" }).click();
  await expect(page.getByText(/Order placed: EON\d+/)).toBeVisible({ timeout: 20_000 });

  const cartIdAfter = await page.evaluate(() => localStorage.getItem("emporix.cartId"));
  expect(cartIdAfter).toBeNull(); // cleared after successful order
});
```

- [ ] **Step 3: Run**

```bash
pnpm -F @viu/emporix-e2e exec playwright test specs/guest-checkout.spec.ts
```

Expected: 1 test passes. The order is placed on the real `viu` tenant — visible in the Management Dashboard.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/guest-checkout.spec.ts
git commit -m "test(examples): e2e guest-checkout spec — cart to order placement"
```

---

## Task 7: Customer-cart-onboarding spec — `customer-cart-onboarding.spec.ts`

**Files:**
- Create: `e2e/specs/customer-cart-onboarding.spec.ts`

- [ ] **Step 1: Walk through via Agent CLI**

```bash
playwright-cli open http://localhost:5173/guest
playwright-cli evaluate "() => localStorage.clear()"
playwright-cli reload
playwright-cli click <start-button-uid>
# Note the guest cartId — capture from localStorage
playwright-cli evaluate "() => localStorage.getItem('emporix.cartId')"
# → "guest-abc"
playwright-cli goto http://localhost:5173/account
playwright-cli fill <email-uid> "<test-email>"
playwright-cli fill <password-uid> "<test-password>"
playwright-cli click <login-uid>
playwright-cli snapshot
# Expect: cartId in localStorage changed to a different value (customer cart id)
playwright-cli evaluate "() => localStorage.getItem('emporix.cartId')"
# → "cust-xyz"  (different from guest-abc)
playwright-cli close
```

- [ ] **Step 2: Write the spec**

```typescript
import { test, expect } from "../fixtures/test-customer";

test("guest cart is merged into the customer cart on login", async ({ page, customer }) => {
  // 1. Fresh start, create guest cart.
  await page.goto("/guest");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Start guest cart" }).click();
  await expect(page.getByText(/^Cart: /)).toBeVisible({ timeout: 15_000 });
  const guestCartId = await page.evaluate(() => localStorage.getItem("emporix.cartId"));
  expect(guestCartId).not.toBeNull();

  // 2. Observe the network calls during login.
  const cartCalls: { method: string; path: string }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("api.emporix.io")) {
      const path = new URL(url).pathname;
      if (path.includes("/cart/")) cartCalls.push({ method: req.method(), path });
    }
  });

  // 3. Log in.
  await page.goto("/account");
  await page.getByPlaceholder("email").fill(customer.email);
  await page.getByPlaceholder("password").fill(customer.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible({ timeout: 15_000 });

  // 4. The onboarding fetched + merged.
  const realCalls = cartCalls.filter((c) => c.method !== "OPTIONS");
  expect(realCalls.some((c) => c.method === "GET" && c.path === "/cart/viu/carts")).toBe(true);
  expect(
    realCalls.some(
      (c) => c.method === "POST" && c.path.endsWith("/merge"),
    ),
  ).toBe(true);

  // 5. Storage now holds the customer cart id (different from the guest one).
  const customerCartId = await page.evaluate(() => localStorage.getItem("emporix.cartId"));
  expect(customerCartId).not.toBeNull();
  expect(customerCartId).not.toBe(guestCartId);
});
```

- [ ] **Step 3: Run**

```bash
pnpm -F @viu/emporix-e2e exec playwright test specs/customer-cart-onboarding.spec.ts
```

Expected: 1 test passes. This is the live verification of PR #26's claim that login auto-merges the guest cart.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/customer-cart-onboarding.spec.ts
git commit -m "test(examples): e2e customer-cart-onboarding spec — merge on login"
```

---

## Task 8: CI workflow

**Files:**
- Create: `.github/workflows/e2e.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: E2E

on:
  workflow_dispatch:
    inputs:
      log_level:
        description: Playwright log level
        required: false
        default: info

concurrency:
  group: e2e
  cancel-in-progress: true

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}

      - name: Install Chromium
        run: pnpm --filter @viu/emporix-e2e exec playwright install --with-deps chromium

      - name: Build SDK
        run: pnpm -F @viu/emporix-sdk build

      - name: Build React
        run: pnpm -F @viu/emporix-sdk-react build

      - name: Run E2E
        run: pnpm e2e
        env:
          CI: "true"
          EMPORIX_TEST_CUSTOMER_EMAIL: ${{ secrets.EMPORIX_TEST_CUSTOMER_EMAIL }}
          EMPORIX_TEST_CUSTOMER_PASSWORD: ${{ secrets.EMPORIX_TEST_CUSTOMER_PASSWORD }}

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: e2e/playwright-report/
          retention-days: 14
```

- [ ] **Step 2: Set GitHub secrets**

Configure these repository secrets (Settings → Secrets and variables → Actions):

- `EMPORIX_TEST_CUSTOMER_EMAIL`
- `EMPORIX_TEST_CUSTOMER_PASSWORD`

Without them, the `customer-session` and `customer-cart-onboarding` specs skip; the other two still run.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e.yml
git commit -m "ci(repo): e2e workflow with manual trigger"
```

---

## Task 9: Documentation

**Files:**
- Create: `docs/e2e.md`

- [ ] **Step 1: Write the doc**

```markdown
# End-to-End Tests

Live smoke tests for the SDK + React package, run through the `examples/vite-spa` Example against the `viu` tenant.

## Quick start (local)

```bash
# Set credentials if you want to run customer-bound specs (optional).
cat > e2e/.env.local <<EOF
EMPORIX_TEST_CUSTOMER_EMAIL=your-test-email@example.com
EMPORIX_TEST_CUSTOMER_PASSWORD=your-test-password
EOF

set -a; source e2e/.env.local; set +a

# Run all E2E tests (anonymous specs always run; customer-bound specs skip without creds).
pnpm e2e

# Watch mode (headed browser, slow-motion).
pnpm e2e:headed
```

The dev server (`vite-spa` on port 5173) starts automatically. Existing dev server is reused locally; freshly started in CI.

## Test customer setup on `viu`

If you don't have a test customer yet, create one via the Management Dashboard or the API:

```bash
curl -X POST https://api.emporix.io/customer/viu/signup \
  -H "Authorization: Bearer <anonymous-token>" \
  -H "Content-Type: application/json" \
  -d '{"contactEmail":"e2e@example.com","password":"...","preferredLanguage":"de"}'
```

Use a unique email for E2E; orders placed by `guest-checkout.spec.ts` accumulate against this customer over time.

## What each spec covers

| Spec | Needs customer creds? | Asserts |
|---|---|---|
| `catalog.spec.ts` | No | 12 products render; only 1 anonymous-login + 1 product-list call fire |
| `customer-session.spec.ts` | Yes | login → "Signed in as ..."; logout clears token |
| `guest-checkout.spec.ts` | No | Cart create → addItem → placeOrder → `EONxxxx` order id; cartId cleared after order |
| `customer-cart-onboarding.spec.ts` | Yes | Guest cart → login → `GET /carts?siteCode=…` + `POST /merge` happen; storage cartId changes to customer's |

## How Claude authors specs

The Playwright Agent CLI (`playwright-cli open`, `playwright-cli snapshot`, etc.) is Claude's interactive walkthrough tool — equivalent to `playwright codegen` but with concise accessibility snapshots optimized for agent loops. Workflow:

1. Start the dev server: `pnpm -F @viu/emporix-examples-vite-spa dev`.
2. `playwright-cli open http://localhost:5173/<path>` and capture the page state.
3. Drive the scenario via `playwright-cli click <uid>`, `playwright-cli fill <uid> "<value>"`, etc.
4. Translate the captured selectors into `@playwright/test` syntax in the spec file.
5. Commit the spec; the Agent CLI session is discarded.

The committed test code uses **only** `@playwright/test`. The Agent CLI does not appear in the test runtime.

## CI

`.github/workflows/e2e.yml` is `workflow_dispatch`-only initially. Trigger via the Actions tab or:

```bash
gh workflow run e2e.yml
```

When the suite is green across at least two weeks of manual runs, switch the trigger to `pull_request`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/e2e.md
git commit -m "docs(docs): e2e testing guide"
```

---

## Final Verification

- [ ] **Local full run (with creds set)**

```bash
set -a; source e2e/.env.local; set +a
pnpm e2e
```

Expected: 4 specs, 6 tests total (catalog has 2, others 1 each), all pass.

- [ ] **Local skip behavior (without creds)**

```bash
unset EMPORIX_TEST_CUSTOMER_EMAIL EMPORIX_TEST_CUSTOMER_PASSWORD
pnpm e2e
```

Expected: catalog + guest-checkout pass; customer-session + customer-cart-onboarding skip cleanly. Suite exits 0.

- [ ] **CI dry-run**

```bash
gh workflow run e2e.yml
gh run watch
```

Expected: workflow completes green within ~10 min. Reports show all four specs.

- [ ] **Project surface check**

```bash
git grep -nE "playwright-cli " e2e/ 2>/dev/null
```

Expected: empty — no leakage of Agent CLI commands into committed code (specs use `@playwright/test` only).

- [ ] **Documentation present**

```bash
ls docs/e2e.md .github/workflows/e2e.yml
```

Expected: both files exist.

---

## Follow-up (out of scope)

- Promote the `e2e.yml` trigger from `workflow_dispatch` to `pull_request` after two weeks of stable green runs.
- `next-app-router` E2E coverage (SSR-specific harness; separate plan).
- Cross-browser matrix (firefox, webkit).
- Visual regression snapshots (Playwright supports it; needs design buy-in for baselines).
- Performance budgets (Lighthouse plug-in).
- Multi-tenant matrix (only `viu` today).
- Test-data cleanup automation (orders accumulate; consider periodic teardown if it becomes a problem).
