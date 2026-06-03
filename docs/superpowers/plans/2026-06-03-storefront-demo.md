# Storefront Demo (`examples/storefront-demo`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> subagent-driven-development) to implement this plan. Use **frontend-design** for
> all visual implementation (Editorial Luxe). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A polished, runtime-configurable (tenant + storefront clientId), pure
Vite+React SPA demo storefront covering all non-B2B Emporix flows, on the current
toolchain (React 19, react-router 7).

**Architecture:** `ConfigGate` builds the `EmporixClient` from user-entered config,
mounts `EmporixProvider`; routed pages compose `@viu/emporix-sdk-react` hooks; an
Editorial-Luxe design system (tokens + CSS Modules) drives the look.

**Tech:** Vite (latest), React 19, react-router-dom 7, @tanstack/react-query 5,
TypeScript 5.6, `@fontsource-variable/{fraunces,hanken-grotesk}`.

**Spec:** `docs/superpowers/specs/2026-06-03-storefront-demo-design.md`
**Branch:** `examples/storefront-demo` (created off `main`).

**Verification note:** Examples have no unit tests. Per task, verify with
`pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` (once),
then `pnpm -F @viu/emporix-examples-storefront-demo typecheck`, plus a `dev` smoke
at milestones. Commit after each task.

---

### Task 1: Scaffold the example

**Files (create):** `examples/storefront-demo/{package.json, vite.config.ts,
tsconfig.json, index.html, .env.example, src/main.tsx, src/App.tsx, src/vite-env.d.ts}`

- [ ] **Step 1: Install current deps & record resolved versions**

From repo root:
```bash
mkdir -p examples/storefront-demo/src
# author package.json (below), then:
pnpm -F @viu/emporix-examples-storefront-demo add react@^19 react-dom@^19 react-router-dom@^7 @tanstack/react-query@^5.51 @viu/emporix-sdk@workspace:* @viu/emporix-sdk-react@workspace:* @fontsource-variable/fraunces @fontsource-variable/hanken-grotesk
pnpm -F @viu/emporix-examples-storefront-demo add -D vite @vitejs/plugin-react typescript@^5.6 @types/react@^19 @types/react-dom@^19
```
Let pnpm resolve latest within the majors; the resulting `package.json` is the
pinned record. Confirm the `vite` ↔ `@vitejs/plugin-react` majors are compatible.

`package.json` (name must match `@viu/emporix-examples-*` for changeset-ignore):
```json
{
  "name": "@viu/emporix-examples-storefront-demo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "echo \"(no tests for example)\" && exit 0",
    "lint": "echo \"(lint skipped for example)\" && exit 0"
  }
}
```

- [ ] **Step 2: Config files**

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
```

`tsconfig.json` (mirror vite-spa):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": [], "noEmit": true },
  "include": ["src"]
}
```

`src/vite-env.d.ts`: `/// <reference types="vite/client" />`

`index.html`: standard Vite root with `<div id="root">` and `<title>Emporix
Storefront — Demo</title>`; `<script type="module" src="/src/main.tsx">`.

`.env.example`: note that NO env is required (config is entered at runtime); list
optional `VITE_DEMO_DEFAULT_TENANT` / `VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID`
prefill hooks (read in the SetupScreen as defaults only).

`src/main.tsx` (temporary minimal until Task 4):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx` (temporary): `export function App() { return <h1>Storefront demo</h1>; }`

- [ ] **Step 3: Verify**

```bash
pnpm install
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build   # vite build smoke
```
Expected: install ok, typecheck clean, build succeeds.

- [ ] **Step 4: Commit** — `git add examples/storefront-demo pnpm-lock.yaml && git commit -m "feat(examples): scaffold storefront-demo (vite, react 19)"`

---

### Task 2: Editorial-Luxe design system

**Files:** `src/styles/{tokens.css, global.css}`, `src/components/ui/{Button,Field,Tag,Spinner,EmptyState}.tsx` (+ `.module.css`), `src/main.tsx` (import fonts + css)

- [ ] **Step 1: Tokens** — `src/styles/tokens.css`:
```css
:root {
  --paper: #f7f3ec;  --ink: #14110d;  --oxblood: #6b1f1f;
  --muted: #8a8175;  --line: #e3dccf;  --paper-2: #efe7d8;
  --font-display: "Fraunces Variable", Georgia, serif;
  --font-body: "Hanken Grotesk Variable", system-ui, sans-serif;
  --step--1: clamp(.8rem,.76rem + .2vw,.9rem);
  --step-0: clamp(1rem,.95rem + .25vw,1.125rem);
  --step-2: clamp(1.6rem,1.3rem + 1.5vw,2.4rem);
  --step-4: clamp(2.6rem,1.9rem + 3.4vw,4.6rem);
  --space: .5rem; --gutter: clamp(1rem,.6rem + 2vw,2.5rem);
  --radius: 2px; --maxw: 78rem;
  --ease: cubic-bezier(.2,.7,.2,1);
}
```

- [ ] **Step 2: Global** — `src/styles/global.css`: modern reset; `body` =
`var(--paper)`/`var(--ink)`/`var(--font-body)`; headings use `--font-display`;
prices use `--font-display` (tabular-nums); a `@keyframes rise` (translateY+fade)
used for staggered reveals; hairline `hr`/borders via `--line`; focus-visible
outline in `--oxblood`; `.u-underline` hover draw effect.

- [ ] **Step 3: Fonts + css in `main.tsx`**:
```tsx
import "@fontsource-variable/fraunces";
import "@fontsource-variable/hanken-grotesk";
import "./styles/tokens.css";
import "./styles/global.css";
```

- [ ] **Step 4: Primitives** — small, typed, CSS-Module components:
`Button` (variants: solid oxblood / outline / ghost; sizes), `Field` (label +
input/select + error text), `Tag`, `Spinner` (editorial thin rule loader),
`EmptyState`. Each `.module.css` uses tokens; no inline hex.

- [ ] **Step 5: Verify** typecheck + `dev` smoke (fonts load, primitives render
on a scratch route). **Commit** — `feat(examples): editorial-luxe design system`.

---

### Task 3: Runtime config gate

**Files:** `src/config/useDemoConfig.ts`, `src/config/ConfigGate.tsx`,
`src/config/SetupScreen.tsx` (+ css)

- [ ] **Step 1: `useDemoConfig`**:
```ts
export interface DemoConfig {
  tenant: string; storefrontClientId: string;
  host?: string; siteCode?: string; currency?: string;
}
const KEY = "emporix.demo.config";
const TENANT_RE = /^[a-z][a-z0-9]+$/;
export function readConfig(): DemoConfig | null { /* JSON.parse(localStorage[KEY]); validate tenant 3-16 + TENANT_RE + clientId; else null */ }
export function writeConfig(c: DemoConfig): void { localStorage.setItem(KEY, JSON.stringify(c)); }
export function clearConfig(): void { localStorage.removeItem(KEY); }
export function useDemoConfig() { /* useState(readConfig); set = (c)=>{writeConfig(c);setState(c)}; reset = ()=>{clearConfig();setState(null)} */ }
```

- [ ] **Step 2: `SetupScreen`** — Editorial-Luxe form: tenant, storefront
clientId, optional host/siteCode/currency (prefilled from `import.meta.env`
defaults if present). Validates with `TENANT_RE` + 3–16 length; inline errors.
**Prominent warning banner**: "This demo talks to a LIVE Emporix tenant and can
place REAL orders — use a test/sandbox tenant." Submit → `writeConfig`.

- [ ] **Step 3: `ConfigGate`** — `const { config, reset } = useDemoConfig();
if (!config) return <SetupScreen onSubmit={set} />; return children(config, reset)`
(render-prop or context exposing config + reset).

- [ ] **Step 4: Verify** typecheck + dev smoke (no config → setup; submit valid →
gate passes; invalid tenant → error). **Commit** — `feat(examples): runtime config gate`.

---

### Task 4: Provider, shell, router, errors, telemetry

**Files:** `src/main.tsx` (final), `src/App.tsx` (final, router), `src/app/{AppShell,Header,Footer}.tsx`, `src/app/SiteCurrencySwitcher.tsx`, `src/app/AccountMenu.tsx`, `src/app/CartBadge.tsx`, `src/app/Toasts.tsx`, `src/app/TelemetryHUD.tsx`, `src/app/RouteError.tsx`

- [ ] **Step 1: Client + provider wiring** — inside `ConfigGate`'s child build the
client once (`useMemo` on config) and mount the provider:
```tsx
const client = useMemo(() => new EmporixClient({
  tenant: config.tenant,
  ...(config.host ? { host: config.host } : {}),
  credentials: { backend: { clientId: "", secret: "" }, storefront: { clientId: config.storefrontClientId,
    ...(config.siteCode || config.currency ? { context: { ...(config.siteCode?{siteCode:config.siteCode}:{}) , ...(config.currency?{currency:config.currency}:{}) } } : {}) } },
  logger: { level: "warn" },
}), [config]);
// EmporixProvider client={client} storage={createLocalStorageStorage()} onTelemetry={pushTelemetry}
```
> `backend.secret: ""` is intentional — service-token calls are never made; the
> demo is anonymous + customer only. (If `validateConfig` rejects empty backend,
> omit `backend` entirely — verify against `core/config` at implementation.)

- [ ] **Step 2: Router** (`react-router-dom@7`, `BrowserRouter` + `<Routes>` as in
vite-spa) with all routes from the spec, each wrapped in `<RouteError>`
(`EmporixErrorBoundary` + reset). Lazy-load route pages with `React.lazy` +
`<Suspense>` (editorial spinner).

- [ ] **Step 3: Shell** — `AppShell` (header/main/footer). `Header`: wordmark
(Fraunces), `SearchBar` (debounced → `/search?q=`), `SiteCurrencySwitcher`
(`useSites`/`useSiteContext`), `CartBadge` (`useActiveCart` count), `AccountMenu`
(`useCustomerSession` → login/account links). `Footer`: links + Telemetry-HUD
toggle + the active tenant + a "Settings" button (calls `reset`).

- [ ] **Step 4: Cross-cutting** — `Toasts` (context + `useEmporixErrorHandler`
default surfacing `EmporixAuthError`/errors as toasts), `TelemetryHUD` (reuse the
vite-spa pattern: `onTelemetry` pushes events into a HUD list).

- [ ] **Step 5: Verify** typecheck + dev smoke (shell renders, routes navigate,
404 + error boundary behave). **Commit** — `feat(examples): provider, shell, router`.

---

### Task 5: Data adapters + query helpers

**Files:** `src/lib/adapters.ts`, `src/lib/format.ts`

- [ ] **Step 1: Typed view-model adapters** — map SDK read types → UI view models,
**pinning the real generated field names** at implementation (do NOT guess):
`toProductCard(product)`, `toGalleryMedia(productMedia)`, `toCartLine(item)`,
`toOrderRow(order)`, `toAddressVM(address)`, `priceOf(...)`. Each adapter is the
single place a field-name change must be fixed.

- [ ] **Step 2: `format.ts`** — `money(amount, currency)` (Intl.NumberFormat),
`date(iso)`. **Verify** typecheck. **Commit** — `feat(examples): view-model adapters`.

---

### Task 6: Catalog (home, category, grid, card)

**Files:** `src/pages/Home.tsx`, `src/pages/Category.tsx`, `src/pages/Search.tsx`, `src/catalog/{Hero,ProductGrid,ProductCard,CategoryNav}.tsx`

- [ ] **Step 1** Home: `Hero` (editorial headline) + featured `ProductGrid`
(`useProducts`) + `CategoryNav` (`useCategories`). Asymmetric grid (alternating
spans), staggered reveal (`animation-delay: calc(var(--i) * 60ms)`).
- [ ] **Step 2** `Search` page: `useProductSearch(debouncedQuery)`; empty/loading/
empty-result states (`EmptyState`).
- [ ] **Step 3** `Category`: `useProductsInCategoryInfinite` + infinite sentinel.
- [ ] **Step 4** `ProductCard`: image (hover scale), name (Fraunces), `PriceTag`,
link to PDP. Acceptance: grid renders against a real tenant, search works, infinite
scroll loads pages. **Verify** typecheck + dev smoke. **Commit** — `feat(examples): catalog pages`.

---

### Task 7: Product detail (PDP)

**Files:** `src/pages/Product.tsx`, `src/catalog/{ProductGallery,VariantPicker,AddToCartBar,AddToListButton}.tsx`

- [ ] PDP via `useProductByCode`/`useProduct` (route param), `useVariantChildren`
(variant select), `useProductMedia` (gallery). `AddToCartBar` →
`useCartMutations().addItem` (toast on success, qty stepper). `AddToListButton` →
`useShoppingLists`/`useAddToShoppingList` (menu of lists + create). Acceptance:
view product, switch variant, add to cart (badge updates), add to a list.
**Verify** + **Commit** — `feat(examples): product detail page`.

---

### Task 8: Cart

**Files:** `src/pages/Cart.tsx`, `src/cart/{CartLine,QuantityStepper,CouponField,OrderSummary}.tsx`

- [ ] `useActiveCart({ create: true })` + `useCartMutations` (qty update / remove /
clear, optimistic). `CouponField` → `useRedeemCoupon` (apply/remove, show
discount). `OrderSummary` (subtotal/discount/total via adapters). Empty-cart
state. Acceptance: change qty, remove, apply a coupon, see totals update.
**Verify** + **Commit** — `feat(examples): cart page`.

---

### Task 9: Checkout (real order)

**Files:** `src/pages/Checkout.tsx`, `src/checkout/{AddressStep,PaymentModePicker,PlaceOrderPanel}.tsx`

- [ ] Auth-aware (`useCheckout` auto-detects customer vs guest). Steps: contact/
address (`useCustomerAddresses` for customers, inline form for guests) →
`PaymentModePicker` (`usePaymentModes`) → `PlaceOrderPanel`. **Real order**:
`useCheckout().placeOrder.mutateAsync({ input })` behind an explicit confirm +
restated **live-tenant warning**; on success show order confirmation (id) + link
to `/account/orders/:id`. Acceptance: complete a guest and a customer checkout on
a test tenant. **Verify** + **Commit** — `feat(examples): checkout with real order placement`.

---

### Task 10: Account core (auth, profile, addresses, reset)

**Files:** `src/pages/Account.tsx`, `src/pages/account/{Profile,Addresses,ResetPassword}.tsx`, `src/account/{AuthTabs,ProfileForm,PasswordForm,AddressList,AddressForm}.tsx`

- [ ] `Account`: if not signed in → `AuthTabs` (login/signup via
`useCustomerSession`); else dashboard (links + logout). `Profile`:
`useUpdateCustomer` + `PasswordForm` (`useChangePassword`). `Addresses`:
`useCustomerAddresses` + `useAddressMutations` (add/edit/delete, default).
`ResetPassword`: `usePasswordReset` (request + confirm token form). Acceptance:
signup→login→logout, edit profile, change password, CRUD an address, request
reset. **Verify** + **Commit** — `feat(examples): account (auth, profile, addresses)`.

---

### Task 11: Account self-service (orders, returns, rewards, lists)

**Files:** `src/pages/account/{Orders,OrderDetail,Returns,Rewards,Lists}.tsx`, `src/account/{OrderRow,ReturnForm,RewardsPanel,ShoppingListPanel}.tsx`

- [ ] Orders: `useMyOrdersInfinite` (history) + `useOrder` (detail) with
`useReorder`, `useCancelOrder`, `useOrderTransition`, and a "start return" entry.
Returns: `useMyReturns`/`useReturn` + `useCreateReturn` (create-from-order form).
Rewards: `useMyRewardPoints`/`useMyRewardPointsSummary` + `useRedeemOptions`/
`useRedeemRewardPoints`. Lists: `useShoppingLists` + create/delete/add/remove/
set-qty. Acceptance: view orders, reorder, start a return, view points + redeem,
manage a list. **Verify** + **Commit** — `feat(examples): account self-service flows`.

---

### Task 12: README + final verification + finish

**Files:** `examples/storefront-demo/README.md`, root `README.md` (examples list)

- [ ] **Step 1: README** — what it is, the **real-order warning**, setup (enter
tenant + storefront clientId at runtime; no secret needed), `pnpm -F
@viu/emporix-examples-storefront-demo dev`, and a flow checklist. Add the example
to the root README examples line.
- [ ] **Step 2: Full verify**:
```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -r typecheck && pnpm -r build
```
Expected: all green (examples typecheck + build). No changeset (example is
`@viu/emporix-examples-*` → Changesets-ignored).
- [ ] **Step 3: dev smoke** against a real test tenant: setup gate → catalog →
PDP → cart → checkout → account flows.
- [ ] **Step 4** finishing-a-development-branch (user pushes manually; merges PR
externally).

---

## Self-Review

- **Spec coverage:** scaffold (T1), design system (T2), runtime config + warning
  (T3), provider/shell/router/errors/telemetry (T4), adapters (T5), catalog (T6),
  PDP (T7), cart+coupon (T8), checkout+real-order (T9), account core (T10),
  self-service incl. returns/rewards/lists/reorder (T11), README+verify (T12). ✓
- **Current versions:** React 19 / RR7 installed in T1; resolved versions pinned
  from `pnpm add`. ✓
- **No-guessing guard:** field-name risks isolated to `lib/adapters.ts` (T5),
  pinned against generated types at implementation; `validateConfig` empty-backend
  behavior verified in T4 Step 1. ✓
- **Aesthetic:** tokens/fonts/motion fixed in T2; frontend-design drives all pages. ✓
- **Packaging:** name `@viu/emporix-examples-storefront-demo` (changeset-ignored),
  not wired into e2e, examples-glob auto-included. ✓
- **Execution note:** Tasks 6–11 are largely independent page-groups → good
  candidates for superpowers:dispatching-parallel-agents once the foundation
  (T1–T5) is in place.
