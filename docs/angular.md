# Angular bindings

`@viu/emporix-sdk-angular` wires the Emporix SDK into an Angular application:
one `provideEmporix()`, signal-based `inject*` functions over TanStack Query, and
the same cache keys and auth resolution as `@viu/emporix-sdk-react` — literally
the same key builder, asserted by test.

**Status: foundation.** The primitives, the site context and the customer session
are here. The 33 read and mutation injectables that mirror the React hooks are
not — see [What is not here yet](#what-is-not-here-yet), which names the gap in
numbers rather than leaving you to discover it by failing to import.

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

`injectEmporixInfinite` takes the same input plus TanStack's `getNextPageParam`
and `initialPageParam`.

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
`isPending`, `error` are signals. `login`, `signup`, `logout` and
`refreshSession` are the actions.

`login` does more than store a token, and the extras are the part worth knowing:

1. Persists all three tokens, and drops the now-dormant anonymous session.
2. **Loads or creates the customer cart and merges the guest cart into it.**
   Best-effort — a cart failure never costs the customer their session, but it
   also means a silent failure here loses a basket. If you wire error tracking,
   this is a path worth watching.
3. Switches to the customer's `preferredSite` if it differs, sharing the profile
   cache entry so `/customer/me` is one billed call rather than two.

`logout` calls the server best-effort, then clears locally regardless, and
**removes** rather than invalidates the `["emporix"]` cache. Customer-scoped
entries are keyed by auth kind with no user id, so a later login as a different
customer would otherwise be served the previous customer's data.

## Server-side rendering

`@viu/emporix-sdk-angular/ssr` re-exports `TransferState` and `makeStateKey`.
There is no cache-tag layer here and there will not be one: tags and
`revalidateTag` are Next concepts, and Angular SSR has no equivalent
invalidation model. Hydration is the problem this entry addresses.

## What is not here yet

`@viu/emporix-sdk-react` exports **107 hooks**. This foundation ships the
primitives plus the site and customer-session layers; the injectables that mirror
those hooks are planned as **33**, and the remaining **74** are out of scope for
the first release:

| Area | Count | Area | Count |
|---|---|---|---|
| companies / B2B | 17 | reward points | 4 |
| customer account extras | 10 | approvals | 4 |
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
