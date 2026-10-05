# Emporix Storefront Demo

A complete, self-contained storefront built on `@viu/emporix-sdk` +
`@viu/emporix-sdk-react`. Pure Vite + React 19 (CSR) — no backend, no secrets.
You enter a **tenant** and a **public storefront client id** at runtime and the
app drives every common (non-B2B) commerce flow against that real tenant.

It doubles as a reference: each screen is a worked example of the hooks, and the
SDK/response field reads live in exactly one place — but that place is no longer
this demo. They moved to [`examples/shared`](../shared) so this demo,
`next-server-first` and `angular-storefront-demo` cannot drift apart.
`src/lib/adapters.ts` is now a re-export of that package plus the two helpers
that need a browser (`sanitizeHtml`, `productDescription`). Follow the
re-export, not the filename.

> ## ⚠️ This places **real orders**
> The demo talks to a **real Emporix tenant**. Checkout creates a **real
> order**, and the account flows create/modify **real** addresses, returns and
> shopping lists. **Use a test / sandbox tenant** — not production.

## Live demo & deployment

This demo is built and deployed to GitHub Pages by `.github/workflows/pages.yml`
on every push to `main` that touches the demo, `examples/shared`, `packages/` or
the workflow itself, and on a manual run (no build artifacts are committed). Once
enabled it is served at:

```
https://viuteam.github.io/emporix-sdk/
```

It ships **no tenant binding and no secrets** — open the page and enter a tenant
+ public storefront client id on the setup screen (kept in `localStorage`).

**One-time setup (repo owner):**

- GitHub → **Settings → Pages → Source → "GitHub Actions"**.
- In the Emporix tenant you demo against, allow the `https://viuteam.github.io`
  origin (CORS, and OAuth redirect URIs if you use the login redirect).

**Custom domain / different repo:** the Pages sub-path is set via `VITE_BASE` in
the workflow (`/emporix-sdk/`). For a custom domain set `VITE_BASE=/` and add a
`CNAME`.

## Run

```bash
pnpm -F @viu/emporix-examples-storefront-demo dev
```

Vite prints a local URL (e.g. `http://localhost:5173`). On first load the setup
screen asks for two things, in two steps:

1. **Connect** — the **tenant** (lowercase, 3–16 chars, `a–z`, `0–9`) and its
   **public storefront client id** (no secret). The API host sits under
   «Advanced» and defaults to `https://api.emporix.io`. «Connect» signs in
   anonymously right away, so a wrong tenant or client id fails here.
2. **Choose a site** — the tenant's active sites, with currency and ship-to
   countries. The site sets the price context: its currency and its home country
   become the session's `currency` and `targetLocation`, which is what makes
   prices resolve. Optionally pick a **featured category** to fill the home page;
   choose one whose products have a price on that site.

Config is kept in `localStorage` (`emporix.demo.config`), and a site switch in
the header is saved there too. **Change setup** in the footer starts over and
drops the stored guest session and cart. `VITE_DEMO_DEFAULT_TENANT` and
`VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID` prefill step 1.

> Examples typecheck against the **built** `dist/` of the SDK packages. After
> changing SDK/React source run `pnpm -F @viu/emporix-sdk build && pnpm -F
> @viu/emporix-sdk-react build` before `pnpm -F
> @viu/emporix-examples-storefront-demo typecheck`.

## Flow checklist

- **Catalog** — home with a featured category and category chips, a
  category-tree sidebar on category and search pages, and grids that put priced
  products first and add to the cart from the card (`useProductsInCategory`,
  `useCategoryTree`, `useMatchPrices`, `useCartCommands`).
- **Product detail** — gallery, article number, variant picker, add-to-cart with
  the price row Emporix requires; without a price in the site's context the
  button is disabled and says why (`useProduct`, `useVariantChildren`,
  `useCartCommands`).
- **Cart** — line items with image and article number, quantity (`partial`),
  coupons, and a summary that separates the subtotal from the delivery estimate
  Emporix already counts into the cart's total. Every cart change is one command
  chain (the write plus `GetCart`), so it costs one request instead of a write
  and a refetch.
- **Checkout** — an accordion of five steps (contact, shipping address,
  delivery, payment, review) for guests **and** signed-in customers; a customer
  with everything on file starts at the review. Delivery methods come cheapest
  first, and the summary replaces Emporix's delivery estimate with the chosen
  method: subtotal, discount, fees, delivery and VAT (net with a VAT line on a
  site whose prices exclude tax), and a gross total that is also the payment
  amount. Places a real order, then clears the closed cart. The customer path
  sends the `saas-token` header; a `payment-gateway` mode also sends its code as
  `method`.
- **Account** — sign in / sign up, profile, password, addresses
  (`useCustomerSession`, `useUpdateCustomer`, `useChangePassword`,
  `useCustomerAddresses`/`useAddressMutations`), and password reset.
- **Self-service** — order history + detail with reorder / cancel / start a
  return, returns list, reward points + redeem, shopping lists.

## Things worth knowing

- **Customer checkout needs the `saasToken`.** It is required as the
  `saas-token` header. The SDK persists it next to the customer token, so a
  reload keeps it; `setSaasToken` is optional on a storage adapter, though, and a
  session without it gets a sign-in form in the checkout's first step instead of
  a failing «Place order».
- **Orders can stay in `IN_CHECKOUT`.** The checkout preselects the tenant's
  first payment mode and sends it as `payment-gateway`; such an order may wait in
  `IN_CHECKOUT` until its payment settles. Only a tenant without any mode falls
  back to the `custom` provider, which Emporix documents as creating the order in
  `IN_CHECKOUT`. A signed-in customer's confirmation links straight to the order;
  a guest's has no link, because the order pages need a sign-in.
- **Two order shapes.** The list and the single-order GET return different
  shapes; `orderVM`/`orderItems` read both. They live in
  [`examples/shared/src/adapters.ts`](../shared/src/adapters.ts), not in this
  demo — `src/lib/adapters.ts` only re-exports them.
- **Prices depend on the site.** The price match resolves against the session's
  currency and country, which the setup derives from the chosen site. A product
  without a price in that context shows «No price in this context» and cannot be
  added to the cart.

## Layout

```
src/
  App.tsx      providers (EmporixProvider, ToastProvider), ContextPersistor and the routes
  config/      the two-step setup (SetupScreen, connect.ts) and its gate (ConfigGate)
  app/         shell, header/footer, toasts, route error boundary, telemetry HUD
  catalog/     product card/grid, add-to-cart hook, gallery, variant picker, category chips and sidebar
  checkout/    accordion steps, order summary, totals, confirmation
  account/     auth, profile, addresses, orders, returns, rewards, lists
  components/  ui/ primitives — Button, Field, Tag, Spinner, EmptyState, Alert, RadioCard
  pages/       routed screens (Home, Categories, Search, Category, Product, Cart, Checkout, account/*)
  lib/         re-export of examples/shared, plus usePrices / useProductNames / countries
  styles/      design tokens, base, shell, catalogue and checkout stylesheets
```
