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

# Watch mode (headed browser).
pnpm e2e:headed
```

The dev server (`vite-spa` on port 5173) starts automatically. Existing dev server is reused locally; freshly started in CI.

## Test customer setup on `viu`

If you don't have a test customer yet, create one via the Management Dashboard or the API:

```bash
ANON_TOKEN=$(curl -s "https://api.emporix.io/customerlogin/auth/anonymous/login?tenant=viu&client_id=miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO" | jq -r .access_token)

curl -X POST "https://api.emporix.io/customer/viu/signup" \
  -H "Authorization: Bearer $ANON_TOKEN" \
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

## Trace + report on failure

On a failed test, Playwright records a trace (`retain-on-failure`) and a screenshot. Inspect locally:

```bash
pnpm --filter @viu/emporix-e2e exec playwright show-report
# or for a specific trace:
pnpm --filter @viu/emporix-e2e exec playwright show-trace e2e/test-results/<test-dir>/trace.zip
```

In CI, the report is uploaded as a job artifact named `playwright-report`.
