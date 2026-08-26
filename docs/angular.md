# Angular bindings

`@viu/emporix-sdk-angular` wires the Emporix SDK into an Angular application:
one `provideEmporix()`, signal-based `inject*` functions over TanStack Query, and
the same cache keys and auth resolution as `@viu/emporix-sdk-react` — literally
the same key builder, asserted by test.

**One exception to that key parity: the seven segment reads.** React's segment
hooks hand-roll `["emporix", "segment", "list", { … }]` instead of calling
`emporixKey`, so their keys differ from the ones here, which go through the
shared builder like every other read (`["emporix", "segments", …]`). Closing the
gap means fixing the React side; hand-rolling keys here would also drop them out
of the `["emporix"]`-scoped defaults and invalidation.

**Status: complete for a storefront.** The primitives, the site context, the
customer session, the account-credential operations and the 33 read and mutation
injectables are all here. What is still out is listed in
[What is not here yet](#what-is-not-here-yet) with counts, so the gap is a number
rather than something you discover by failing to import.

## Install

```bash
pnpm add @viu/emporix-sdk @viu/emporix-sdk-angular @tanstack/angular-query-experimental
```

Peers: `@angular/core` and `@angular/common` `>=20.0.0 <23.0.0`. The package is
**ESM only** — `@angular/core` ships no CommonJS entry either, and Angular
applications always bundle.

## Setup

```ts
// app.config.ts
import { EmporixClient } from "@viu/emporix-sdk";
import { provideEmporix } from "@viu/emporix-sdk-angular";
import { createLocalStorage } from "@viu/emporix-sdk-angular/storage";

const client = new EmporixClient({
  tenant: "your-tenant",
  credentials: {
    storefront: {
      clientId: "your-storefront-client-id",
      context: { currency: "CHF", siteCode: "main", targetLocation: "CH" },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideEmporix({
      client,
      storage: createLocalStorage(),
      // Optional: share one cache with the host application.
      // queryClient: myQueryClient,
      // Optional: initialSiteCode, initialLanguage
    }),
  ],
};
```

`provideEmporix` calls `provideTanStackQuery` internally, so there is no second
thing to remember. Without a `storage` it falls back to an in-memory one, which
is SSR-safe but does not survive a reload.

It also applies balanced defaults scoped to the `["emporix"]` key namespace:
`staleTime: 30s`, no window-focus refetch, and **no retry on a 404**. A 404 is an
answer, not a failure worth repeating, and Emporix bills per call. Your own
queries outside that namespace are untouched, and your explicit choices inside it
win over these.

## The one rule that matters

**Read signals INSIDE the options callback, never before it.**

```ts
// WRONG — compiles, passes a happy-path test, and breaks on login.
export class Orders {
  private readonly session = injectCustomerSession()
  private readonly token = this.session.token()          // ← read once, frozen
  orders = injectEmporixQuery(() => ({
    resource: "my-orders", args: [], site: "none",
    mode: this.token ? "customer" : "read-auth",         // ← never re-evaluated
    queryFn: (ctx) => this.client.orders.listMine(ctx),
  }))
}
```

```ts
// RIGHT — the read happens on every re-evaluation.
export class Orders {
  private readonly emporix = injectEmporix()
  orders = injectEmporixQuery(() => ({
    resource: "my-orders", args: [], site: "none",
    mode: "customer",
    queryFn: (ctx) => this.emporix.client.orders.listMine(ctx),
  }))
}
```

`injectQuery` runs the options function in a reactive context, the way `computed`
does. Anything read inside it is tracked, so the cache key and the `enabled` gate
follow login, logout and a site switch. Anything read outside is captured once.

The symptom of getting this wrong is not a crash: it is a customer who logs out
and still sees their own orders, because the `enabled` gate is still holding the
value it had at construction.

`injectEmporixQuery` handles the token and site reads for you. The rule matters
for **your own** signals — a product id, a filter, a page number:

```ts
export class ProductPage {
  private readonly emporix = injectEmporix()
  id = signal("p1")

  product = injectEmporixQuery(() => ({
    resource: "product",
    args: [this.id()],        // ← inside: changing `id` re-keys and refetches
    site: "full",
    mode: "read-auth",
    queryFn: (ctx) => this.emporix.client.products.get(this.id(), undefined, ctx),
  }))
}
```

## Reads

```ts
injectEmporixQuery(() => ({
  resource: string,       // the cache-key segment
  args: readonly unknown[],
  site: "full" | "language" | "none",   // which site discriminators go in the key
  mode: "read-auth" | "customer",
  queryFn: (ctx: AuthContext) => Promise<T>,
  staleTime?: number,
  enabled?: boolean,      // ANDed with the internal gate, never replacing it
  authOverride?: AuthContext,   // read-auth only
}))
```

`mode` is the auth model:

- **`read-auth`** — customer if a token is stored, anonymous otherwise. For a
  catalog read that works either way.
- **`customer`** — token-gated. Keyed as anonymous *and* as customer so a guest's
  entry can never be served to a customer, but only ever **enabled** with a
  token. Nothing is fetched unauthenticated.

### Paginated reads

`injectEmporixInfinite` takes the same input with **`fetchPage` instead of
`queryFn`**, and nothing else:

```ts
products = injectEmporixInfinite<Product, readonly [number]>(() => ({
  resource: "products-infinite",
  args: [24],
  site: "full",
  mode: "read-auth",
  fetchPage: (pageNumber, ctx) =>
    this.emporix.client.products.list({ pageNumber, pageSize: 24 }, ctx),
}))
```

There is deliberately no `getNextPageParam` or `initialPageParam` to supply. Every
paginated Emporix endpoint answers with `pageNumber` and `hasNextPage`, so pages
start at 1 and advance from the server's own `pageNumber + 1` until it says stop —
one correct way to do it, and no call site restating it. Termination is the
server's answer, never a trailing empty request.

`fetchPage` receives the page number because it has to: a plain `queryFn()`
signature cannot see TanStack's `pageParam`, and an earlier version of this
interface silently re-fetched page one forever for exactly that reason.

### Outside an injection context

Both accept `{ injector }`, mirroring `injectQuery`'s own escape hatch rather
than inventing a second convention:

```ts
const query = injectEmporixQuery(() => ({ /* … */ }), { injector: myInjector })
```

### Building options without Angular

`emporixQueryOptions(input, ctx)` is the pure core — auth resolution, cache key
and the `enabled` gate as a plain function with no `@angular/core` import. Useful
for testing your own query composition without a DI container.

## The injectables

33 of them, grouped by area. Every one is a thin wrapper over
`injectEmporixQuery` or `injectEmporixInfinite`, so the auth resolution, the cache
key and the `enabled` gate live in exactly one place. Arguments are **signals**,
read inside the options callback, so changing one re-keys and refetches.

| Area | Injectables |
|---|---|
| Catalog (12) | `injectProduct`, `injectProducts`, `injectProductsInfinite`, `injectProductByCode`, `injectProductNameSearch`, `injectProductSearch`, `injectProductMedia`, `injectCategory`, `injectCategories`, `injectCategoryTree`, `injectProductsInCategory`, `injectProductsInCategoryInfinite` |
| Cart (5) | `injectCart`, `injectCartItems`, `injectActiveCart`, `injectCreateCart`, `injectCartMutations` |
| Checkout (4) | `injectPaymentModes`, `injectShippingZones`, `injectCheckout`, `injectInitializePayment` |
| Customer (4) | `injectCustomerAddresses`, `injectUpdateCustomer`, `injectAddressMutations`, `injectPasswordReset` |
| Orders (3) | `injectMyOrders`, `injectMyOrdersInfinite`, `injectOrder` |
| Prices (3) | `injectMatchPrices`, `injectMatchPricesChunked`, `injectAvailability` |
| Site (2) | `injectSites`, `injectActiveSite` |

**The two searches are easy to mix up.** `injectProductNameSearch(term)` is the
free-text search (`products.searchByName`); `injectProductSearch(filter)` takes a
built Emporix filter (`products.search`). They pair with React's
`useProductNameSearch` and `useProductSearch` respectively. Both answer
`PaginatedItems<Product>`, so reaching for the wrong one typechecks and silently
queries the wrong endpoint.

```ts
export class ProductPage {
  id = signal("p1")
  product = injectProduct(this.id)               // re-keys when `id` changes
  prices = injectMatchPrices(computed(() => ({ items: /* … */ })))
  cart = injectActiveCart({ create: true })      // bootstraps one if needed
  mutations = injectCartMutations()              // resolves the id at call time
}
```

### Four behaviours worth knowing before you rely on them

**`injectCart` forgets a dead cart.** Emporix allows one open cart per site and
closes it when its order is placed, so another device holding that id 404s
*permanently* — a stale id is not `null`, so nothing bootstraps over it. On a 404
the binding clears the stored id, and only while that id is still the stored one:
a caller passing some other cart's id cannot wipe this session's.

**`injectCartMutations` resolves the cart id at call time, not construction**, so a
component that renders before the bootstrap finishes still writes to the right
cart. It throws a named error when storage is still empty. It has **no optimistic
updates** — it invalidates. That is a stated gap: optimistic cart surgery has to be
right per operation or it shows the shopper a basket that does not exist.

**`injectProductMedia` makes no Media-Service call.** It reads `productMedia` off
the product DTO, because `media.listForProduct` defaults to a service-account
context and needs a server-only scope. A storefront calling it gets a request that
never resolves.

**`injectCheckout` owns the parts of checkout that are easy to get wrong:** the
`saas-token` header for a customer checkout (and no token for a guest), the
`siteCode` query, and clearing the closed cart on success. What it cannot do for
you is `customer.id` — present exactly when signed in, or Emporix answers «Cannot
found customer».

## Site, currency, language

```ts
export class Header {
  site = injectEmporixSite()          // signals, read-only
  switcher = injectEmporixSiteSwitch()

  // site.siteCode(), site.currency(), site.language(), site.targetLocation()
  // site.isSwitching(), site.switchError()
}
```

Resolution order for the initial site: `initialSiteCode` → storage → the client's
storefront context → `null`. Same order for the language. Once a site code is
known, one best-effort fetch fills `currency`, `targetLocation` and a default
language — only fields still `null`, because a configured or persisted currency is
the user's choice.

All three switches are **optimistic**: local state and storage flip immediately,
the `["emporix"]` cache is invalidated, and then the server work runs. If the
server work fails, `switchError` is set and **the optimistic state is not rolled
back** — by then the UI has moved and the cache is gone; reverting would show a
site nobody chose.

- `setSite(code | null)` drops the cart id. Carts are site-bound.
- `setCurrency(c)` drops the cart id too, and re-binds the anonymous price
  context so guest pricing changes before any session exists.
- `setLanguage(l)` does **not** touch the cart. Language does not affect price.

## Customer session

```ts
export class Login {
  session = injectCustomerSession()

  async submit(email: string, password: string) {
    await this.session.login({ email, password })
  }
}
```

`token`, `refreshToken`, `saasToken`, `customer`, `isAuthenticated`, `isLoading`,
`isPending`, `error` are signals. `login`, `signup`, `confirmSignup`, `logout` and
`refreshSession` are the actions.

`login` does more than store a token, and the extras are the part worth knowing:

1. Persists all three tokens, and drops the now-dormant anonymous session.
2. **Loads or creates the customer cart and merges the guest cart into it.**
   Best-effort — a cart failure never costs the customer their session, but it
   also means a silent failure here loses a basket. If you wire error tracking,
   this is a path worth watching.
3. Switches to the customer's `preferredSite` if it differs, sharing the profile
   cache entry so `/customer/me` is one billed call rather than two.

`confirmSignup(token)` completes a double opt-in signup **and signs the customer
in** — the response is a full session, so it runs the same path as `login`. That
diverges from React's `useConfirmSignup`, which returns the session and leaves
installing it to a caller who has no supported way to do so. Returning a session
nobody can use is a gap, not a contract worth copying.

`logout` calls the server best-effort, then clears locally regardless, and
**removes** rather than invalidates the `["emporix"]` cache. Customer-scoped
entries are keyed by auth kind with no user id, so a later login as a different
customer would otherwise be served the previous customer's data.

## Credentials and email

`injectCustomerCredentials()` covers the account-management operations, and it is
split along the one boundary that matters:

```ts
creds = injectCustomerCredentials()
// Require a signed-in customer:
creds.changePassword({ currentPassword, newPassword })
creds.changeEmail({ newEmail, password })
// Anonymous by design:
creds.confirmEmailChange({ token })
creds.resendActivation({ email })
```

The two anonymous ones are anonymous on purpose. Their input is a token or an
address that arrived by email, at a point where the visitor has **no session** —
gating them on a login would make a confirmation link dead. The two
customer-scoped ones throw locally when no token is stored, naming the operation,
rather than letting the SDK reject an unauthenticated call.

`changePassword` invalidates nothing: no read query surfaces a password, so there
is nothing stale to drop. `changeEmail` refetches the profile, because Emporix
sends a confirmation first and the profile carries the pending state.

## Server-side rendering

`@viu/emporix-sdk-angular/ssr` re-exports `TransferState` and `makeStateKey`.
There is no cache-tag layer here and there will not be one: tags and
`revalidateTag` are Next concepts, and Angular SSR has no equivalent
invalidation model. Hydration is the problem this entry addresses.

## What is not here yet

`@viu/emporix-sdk-react` exports **107 hooks**. This package ships the primitives,
the site and customer-session layers, the five account-management operations and
the **33** storefront injectables. The remaining **69** are out of scope for the
first release:

| Area | Count | Area | Count |
|---|---|---|---|
| companies / B2B | 17 | reward points | 4 |
| customer account extras | 5 | approvals | 4 |
| catalog extras | 9 | returns | 3 |
| segments | 7 | coupons | 2 |
| shopping lists | 6 | cloud functions | 2 |
| orders extras | 5 | other | 5 |

Also deliberately absent:

- **Telemetry.** React's `EmporixTelemetryEvent` union is a React-Query lifecycle
  (`cache.hit`, `query.refetch`); porting it is its own design question.
- **Customer-token auto-refresh.** Opt-in and default `false` in React, so this
  matches React's default behaviour rather than lacking a feature. Call
  `refreshSession()` yourself.
- **`socialLogin` / `exchangeToken`.** Same call as in
  `@viu/emporix-sdk-next`: both need an IdP configured at the tenant, and an SSO
  surface nobody can exercise is an untested one.
- **B2B company context.** The largest excluded area, and independent of
  everything above.

Until an area lands, call the SDK directly through `injectEmporix().client` and
wrap it in `injectEmporixQuery` yourself — that is exactly what the shipped
injectables do.

## Why there is no `ng-packagr`

This package is built with `tsup`, like every other package in the workspace,
because it exports only functions — `inject*`, `provide*`, `InjectionToken` — and
holds **no decorators**. The Angular compiler is required for decorators and
templates, not for functions; `@tanstack/angular-query-experimental` ships the
same way, with zero compiler output in its artifact.

Two guards keep it true: an ESLint rule that rejects any `Decorator` node in
`packages/angular/src`, and `check:dist`, which greps the built output for
`ɵɵngDeclare`, `ɵprov`, `ɵfac` and `__decorate`. CI additionally builds
`examples/angular-storefront` with `ng build --configuration production` on every
PR, so the claim is measured rather than asserted.

The consequence for contributors: **no components, directives, pipes or
`@Injectable()` classes may be added to this package.** A UI component belongs in
your application, or in a separate package that does use `ng-packagr`.

## Version notes

- **Node.** Angular 22 declares `engines.node: ^22.22.3 || ^24.15.0 || >=26.0.0`
  and the Angular CLI enforces it itself — it exits rather than warning. Unit
  tests and `tsc` do not care; `ng build` does.
- **TypeScript.** `@angular/compiler-cli@22` peers `typescript >=6.0 <6.1`. That
  binds anything compiled by the Angular CLI, not this package, which builds
  with the workspace's TypeScript.

## Related

- [`docs/react.md`](./react.md) — the React bindings this mirrors
- [`docs/auth.md`](./auth.md) — the auth model behind `mode`
- [`docs/pagination.md`](./pagination.md) — what `injectEmporixInfinite` paginates
- [`examples/angular-storefront`](../examples/angular-storefront) — the AOT test rig
- [the design spec](./superpowers/specs/2026-08-25-angular-package-design.md)
