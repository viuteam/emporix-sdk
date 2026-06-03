# Storefront Demo (`examples/storefront-demo`) — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Kind:** New, unpublished example (Vite + React, pure SPA)
**Branch:** `examples/storefront-demo`

## Goal

A polished, self-contained **demo storefront** that showcases the full non-B2B
surface of `@viu/emporix-sdk-react` against **any** Emporix tenant the user
configures **at runtime** (tenant + storefront clientId entered in-app). Serves
as onboarding reference, sales demo, and manual-QA harness. Aesthetic:
**Editorial Luxe**.

Distinct from `examples/vite-spa` (the thin, env-configured reference that the
e2e suite boots) — this is a separate, richer example. The e2e suite stays on
`vite-spa`; this demo is **not** wired into Playwright.

## Why a new example (not extending vite-spa)

`vite-spa` is tightly coupled to the e2e suite (Playwright boots it; specs
expect its env config + routes) and carries B2B bits. Runtime config + a full
non-B2B storefront would destabilize e2e and mix concerns. New example = clean
isolation.

## Key constraint: secretless, storefront-only

The demo runs entirely in the browser with **only** `tenant` + storefront
`clientId` (public, anonymous-token). **No backend secret** ever reaches the
browser. This is safe and CORS-friendly: storefront/customer endpoints are
browser-intended; service-token endpoints are not — so the demo deliberately
covers only anonymous + customer flows (which is also "no B2B, no admin").

> The demo **writes to a live tenant** (real orders enabled — see Checkout). The
> setup screen shows a prominent warning to use a **test/sandbox tenant**.

## Aesthetic system — "Editorial Luxe"

Refined magazine/luxury retail. Light theme, crisp, generous whitespace,
asymmetric grid, large type, one sharp accent.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f7f3ec` | page background |
| `--ink` | `#14110d` | primary text |
| `--oxblood` | `#6b1f1f` | accent (CTAs, links, rules) |
| `--muted` | `#8a8175` | secondary text |
| `--line` | `#e3dccf` | hairline borders |
| display font | **Fraunces** (variable serif) | headings, hero, prices |
| body font | **Hanken Grotesk** (humanist sans) | body, UI |

- **Type scale:** large editorial headings (clamp), tight leading on display,
  comfortable body. Numerals (prices) in Fraunces for character.
- **Layout:** asymmetric product grid (alternating column spans), hairline
  rules, index-style numbering ("no. 04"), wide gutters.
- **Motion (CSS-first):** one orchestrated page-load with staggered reveals
  (`animation-delay` per grid item); hover = image scale + underline draw;
  cart/qty transitions. No heavy animation lib (keep example deps minimal).
- **Fonts:** loaded via `@fontsource` packages (self-hosted, no external CDN at
  runtime) — `@fontsource-variable/fraunces`, `@fontsource-variable/hanken-grotesk`.
- Tokens live in `src/styles/tokens.css`; global resets + primitives in
  `src/styles/global.css`. Plain CSS + CSS Modules per component (no Tailwind,
  no Inter/system-font slop).

## Runtime configuration (Setup Gate)

- `useDemoConfig` reads/writes `localStorage["emporix.demo.config"]` =
  `{ tenant, storefrontClientId, host?, siteCode?, currency? }`.
- `<ConfigGate>` (top of the tree): if no valid config, render `<SetupScreen>`
  (styled form, validation: `tenant` ⇒ `^[a-z][a-z0-9]+$` 3–16, clientId
  non-empty) with the **live-tenant / real-order warning** banner. On submit,
  persist + reload into the app.
- The `EmporixClient` is built via `useMemo` keyed on the config and the
  `EmporixProvider` mounts only once config exists. A header "Settings" control
  clears/edits config (re-shows the gate).
- Storage: `createLocalStorageStorage()` so the customer session + cart survive
  reloads.

## Routes (react-router 7, SPA)

| Path | Page | Hooks |
|---|---|---|
| `/` | Home: hero + featured grid + search + category nav | `useProducts`, `useProductSearch`, `useCategories` |
| `/category/:id` | Category listing (infinite) | `useProductsInCategoryInfinite` |
| `/product/:idOrCode` | PDP: media, variants, add-to-cart, add-to-list | `useProductByCode`/`useProduct`, `useVariantChildren`, `useProductMedia`, `useCartMutations`, `useShoppingLists` |
| `/cart` | Cart: lines, qty, remove, **coupon**, totals | `useActiveCart`, `useCartMutations`, `useRedeemCoupon` |
| `/checkout` | Auth-aware checkout → address → payment mode → **place real order** | `useCheckout`, `usePaymentModes`, `useCustomerAddresses`, `useActiveCart` |
| `/account` | Auth tabs (login/signup) or dashboard when signed in | `useCustomerSession` |
| `/account/profile` | Update profile, change password | `useUpdateCustomer`, `useChangePassword` |
| `/account/addresses` | Address CRUD | `useCustomerAddresses`, `useAddressMutations` |
| `/account/orders` + `/:id` | Order history + detail; **reorder**, cancel, start return | `useMyOrdersInfinite`, `useOrder`, `useReorder`, `useCancelOrder`, `useOrderTransition` |
| `/account/returns` | Returns list + create-from-order | `useMyReturns`, `useReturn`, `useCreateReturn` |
| `/account/rewards` | Points balance + redeem options | `useMyRewardPoints`, `useMyRewardPointsSummary`, `useRedeemOptions`, `useRedeemRewardPoints` |
| `/account/lists` | Shopping lists CRUD + items | `useShoppingLists`, `useCreateShoppingList`, `useDeleteShoppingList`, `useAddToShoppingList`, `useRemoveFromShoppingList`, `useSetShoppingListItemQuantity` |
| `/reset-password` | Request + confirm reset | `usePasswordReset` |

Persistent chrome: header (logo, search, **site/currency switcher**, cart count,
account menu), footer, toast/notification layer, optional **Telemetry HUD** (reuse
the `onTelemetry` pattern from vite-spa) toggled from the footer.

## Component inventory (Editorial Luxe)

- **Shell:** `AppShell`, `Header`, `Footer`, `SiteCurrencySwitcher`, `CartBadge`,
  `AccountMenu`, `ToastProvider`, `TelemetryHUD`.
- **Catalog:** `Hero`, `ProductGrid` (asymmetric), `ProductCard`, `SearchBar`,
  `CategoryNav`, `Pagination`/`InfiniteSentinel`.
- **PDP:** `ProductGallery`, `VariantPicker`, `PriceTag`, `AddToCartBar`,
  `AddToListButton`.
- **Cart/Checkout:** `CartLine`, `QuantityStepper`, `CouponField`,
  `OrderSummary`, `AddressForm`, `PaymentModePicker`, `PlaceOrderPanel`
  (real-order confirm + warning).
- **Account:** `AuthTabs`, `ProfileForm`, `PasswordForm`, `AddressList`,
  `OrderRow`, `OrderDetail`, `ReturnForm`, `RewardsPanel`, `ShoppingListPanel`.
- **Primitives:** `Button`, `Field`, `Tag`, `Spinner`, `EmptyState`,
  `ErrorNotice` (wraps `useEmporixErrorHandler` / `EmporixErrorBoundary`).

## Data flow notes

- Cart: `useActiveCart({ create: true })` bootstraps; mutations are optimistic
  (hook already does rollback). Cart id persisted via storage.
- Checkout auth: `useCheckout` auto-detects customer-vs-anonymous; the demo
  supports **guest and customer** checkout from the same flow.
- Errors: a global `useEmporixErrorHandler` shows toasts; `EmporixErrorBoundary`
  wraps route content.
- Multi-site/currency: `useSiteContext().setSite` drives the switcher; price
  context follows.

## Checkout / real orders

`placeOrder` runs for real (user choice). The `PlaceOrderPanel` requires an
explicit confirm and restates the live-tenant warning. No payment-stop. Document
in README that this creates real orders → use a test tenant.

## Packaging

- Dir `examples/storefront-demo`; package `@viu/emporix-examples-storefront-demo`
  (matches `@viu/emporix-examples-*` ⇒ **changeset-ignored, not published**).
- Picked up by the `examples/*` workspace glob automatically.
- Scripts mirror vite-spa: `dev` (vite), `build` (vite build), `typecheck`
  (`tsc --noEmit`), `test`/`lint` (noop echoes — keeps `pnpm -r` green).
- **Toolchain: current majors** (this example intentionally runs newer
  versions than the other examples — see validation note below):
  - `react@^19`, `react-dom@^19`, `@types/react@^19`, `@types/react-dom@^19`
  - `react-router-dom@^7` (keeps the v6 `<Routes>` / `createBrowserRouter` API)
  - `@tanstack/react-query@^5.51` (v5 supports React 19)
  - `@viu/emporix-sdk` + `@viu/emporix-sdk-react` (`workspace:*`)
  - `@fontsource-variable/fraunces`, `@fontsource-variable/hanken-grotesk`
  - Dev: latest `vite` + matching `@vitejs/plugin-react`, `typescript@^5.6`.
- The plan's scaffold step installs these with `pnpm add` (latest within the
  pinned majors) and **records the resolved versions** in the example's
  `package.json` — rather than guessing patch numbers here.
- `tsconfig.json` extends `../../tsconfig.base.json` (same as vite-spa). Examples
  typecheck against built `dist/` → CI must build SDK first (already the rule).

### Version validation (React 19)

- `@viu/emporix-sdk-react`'s peer is `"react": "^18.0.0 || ^19.0.0"`, so **React
  19 is supported**; the package ships React-version-agnostic (react is a peer,
  not bundled).
- The rest of the repo currently sits on React 18.3.1 (lockfile + the other
  examples). **pnpm resolves React per importer**, so this example can run React
  19 while `packages/*` and the other examples stay on 18.3 — no duplicate-React
  runtime conflict, because the example's own tree resolves a single React 19
  that satisfies the SDK's peer.
- `@tanstack/react-query@^5` and `react-router-dom@^7` both support React 19.
- Trade-off accepted: this adds a second React major to the lockfile. Justified
  by the goal — the demo should showcase the **current** stack.
- README: setup (tenant + storefront clientId), run command, the real-order
  warning, and a flow checklist.

## Testing

Examples carry no unit tests (consistent with the repo). Verification = `pnpm -F
@viu/emporix-examples-storefront-demo typecheck` + a manual `dev` smoke (build
green; setup gate → catalog renders). Not added to Playwright.

## Out of scope

- B2B (no company switcher / legal-entity rescope).
- Any service-token / admin flow (would need a secret in the browser).
- Server-side rendering (pure CSR Vite SPA; the Next example covers RSC).
- Wiring into the e2e suite.
- A changeset (examples are ignored by Changesets).

## Open implementation risks (to handle in the plan)

- Exact read-model field names (product price/media, order entries, address
  shape) must be pinned against the generated types during implementation —
  build small typed adapters rather than guessing.
- `@fontsource-variable` package names must be verified at install.
- Real-order flow depends on the tenant having a usable payment mode + shipping;
  the demo surfaces whatever `usePaymentModes` returns and lets the tenant decide.
- At scaffold, verify the `vite` ↔ `@vitejs/plugin-react` major pairing and that
  `react-router-dom@7`'s `<Routes>`/`createBrowserRouter` usage matches the v6
  patterns in `vite-spa` (RR7 keeps them; confirm no codemod is needed). Pin
  whatever `pnpm add` resolves.
