---
"@viu/emporix-sdk": patch
"@viu/emporix-sdk-react": patch
---

Add live end-to-end test suite (`@viu/emporix-e2e`, private) running through the `examples/vite-spa` Example against the `viu` tenant. Six specs cover the four critical user flows:

- **`catalog.spec.ts`** — anonymous catalog renders 12 products; only `GET /anonymous/login` + `GET /product/viu/products` hit Emporix on `/`.
- **`customer-session.spec.ts`** — login resolves the customer profile + stores the token; logout clears the token.
- **`guest-checkout.spec.ts`** — `useCreateCart` → `useCartMutations.addItem` → `useCheckout.placeOrder` (anonymous) → real order `EONxxxx` placed on `viu`.
- **`customer-cart-onboarding.spec.ts`** — guest cart created → login → `GET /cart/viu/carts?siteCode=main&create=true` + `POST /merge` fire → `storage.cartId` switched to the customer cart.

This is the first **live** verification of the PR #26 customer-cart-onboarding flow, previously covered only by MSW mocks. No SDK/React code changes — the suite is purely additive test infrastructure (separate `e2e/` workspace package, `@playwright/test` v1.49, `workflow_dispatch` CI workflow). Credentials are env-driven (`EMPORIX_TEST_CUSTOMER_EMAIL` / `_PASSWORD`); login-bound specs skip cleanly without them. Passwords are filled via a custom `fillSecret` helper that bypasses `page.fill()` so values never appear in the HTML report or action log.

Local runs: `pnpm e2e`. CI runs: trigger `e2e.yml` from the Actions tab. See [`docs/e2e.md`](../docs/e2e.md) for authoring workflow + Playwright Agent CLI usage.
