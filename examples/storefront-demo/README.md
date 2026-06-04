# Emporix Storefront Demo

A complete, self-contained storefront built on `@viu/emporix-sdk` +
`@viu/emporix-sdk-react`. Pure Vite + React 19 (CSR) — no backend, no secrets.
You enter a **tenant** and a **public storefront client id** at runtime and the
app drives every common (non-B2B) commerce flow against that real tenant.

It doubles as a reference: each screen is a worked example of the hooks, and
`src/lib/adapters.ts` is the single place that reads SDK/response field shapes.

> ## ⚠️ This places **real orders**
> The demo talks to a **real Emporix tenant**. Checkout creates a **real
> order**, and the account flows create/modify **real** addresses, returns and
> shopping lists. **Use a test / sandbox tenant** — not production.

## Run

```bash
pnpm -F @viu/emporix-examples-storefront-demo dev
```

Vite prints a local URL (e.g. `http://localhost:5173`). On first load you get a
setup screen — enter:

| Field | Required | Notes |
| --- | --- | --- |
| **Tenant** | yes | lowercase, 3–16 chars (`a–z`, `0–9`) |
| **Storefront client id** | yes | the **public** storefront client id (no secret) |
| Host | no | defaults to `https://api.emporix.io` |
| Site code | no | e.g. `main` |
| Currency | no | e.g. `CHF` — currency **and** country are needed for prices to resolve |
| Country (`targetLocation`) | no | e.g. `CH` |

Config is kept in `localStorage` (`emporix.demo.config`); use **Change tenant**
in the footer to reset. You can prefill the setup screen with
`VITE_DEMO_DEFAULT_TENANT` and `VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID`.

> Examples typecheck against the **built** `dist/` of the SDK packages. After
> changing SDK/React source run `pnpm -F @viu/emporix-sdk build && pnpm -F
> @viu/emporix-sdk-react build` before `pnpm -F
> @viu/emporix-examples-storefront-demo typecheck`.

## Flow checklist

- **Catalog** — home + curated category-tree nav with sub-category drill-down,
  search, product grid with resolved prices (`useProductSearch`,
  `useCategories`, `useMatchPrices`).
- **Product detail** — gallery, variant picker, add-to-cart with the price row
  Emporix requires (`useProduct`, `useVariantChildren`, `useCartMutations`).
- **Cart** — line items, quantity (`?partial=true`), coupons, totals.
- **Checkout** — guest **and** signed-in customer; places a real order, then
  clears the closed cart. The customer path sends the `saas-token` header.
- **Account** — sign in / sign up, profile, password, addresses
  (`useCustomerSession`, `useUpdateCustomer`, `useChangePassword`,
  `useCustomerAddresses`/`useAddressMutations`), and password reset.
- **Self-service** — order history + detail with reorder / cancel / start a
  return, returns list, reward points + redeem, shopping lists.

## Things worth knowing

- **Customer checkout needs an in-session login.** The `saasToken` (required as
  the `saas-token` header) is held in memory only — never persisted. It is
  shared across components within a session, but a full page reload clears it,
  so sign in and check out in the same session.
- **Order history shows finalized orders.** A freshly placed order sits in
  `IN_CHECKOUT` until payment settles; it is reachable by id (the confirmation
  links straight to it) but won't appear in the history list until finalized.
  The demo's "custom" payment provider is a stub, so its orders stay pending.
- **Two order shapes.** The list and the single-order GET return different
  shapes; `src/lib/adapters.ts` (`orderVM`/`orderItems`) reads both.
- **Prices need currency + country.** Without both in the session context the
  price-match returns nothing and products show no price.

## Layout

```
src/
  config/      runtime tenant/client-id gate (SetupScreen, ConfigGate)
  app/         provider wiring, shell, header/footer, toasts, telemetry HUD
  catalog/     product card/grid, gallery, variant picker, category nav
  account/     auth, profile, addresses, orders, returns, rewards, lists
  pages/       routed screens (Home, Search, Category, Product, Cart, Checkout, account/*)
  lib/         adapters (SDK field reads), price/format helpers
  styles/      Editorial-Luxe design tokens + global stylesheet
```
