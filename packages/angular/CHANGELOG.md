# @viu/emporix-sdk-angular

## 0.1.0

### Minor Changes

- [#301](https://github.com/viuteam/emporix-sdk/pull/301) [`b0549e0`](https://github.com/viuteam/emporix-sdk/commit/b0549e06671a773c4581284c43852124eee8f5a9) Thanks [@amnael1](https://github.com/amnael1)! - feat(angular): add Angular bindings — provideEmporix, 86 signal-based injectables at React parity

  First release of `@viu/emporix-sdk-angular`. One `provideEmporix()` wires the SDK,
  a storage backend and TanStack Query into an Angular application;
  `injectEmporixQuery` and `injectEmporixInfinite` run reads with the same cache
  keys, auth resolution and `enabled` gating as the React bindings — literally the
  same key builder, asserted by test over four site/token combinations.

  Also in this release: the site context as signals with `setSite` / `setCurrency` /
  `setLanguage` (optimistic, with `switchError` and no rollback), and
  `injectCustomerSession` with login, signup, `confirmSignup`, logout and
  `refreshSession` — login included, meaning guest-cart merge and `preferredSite`
  handling, not just a token write.

  `injectCustomerCredentials` covers the account-management operations, split along
  the boundary that matters: `changePassword` and `changeEmail` require a signed-in
  customer, while `confirmEmailChange` and `resendActivation` are anonymous by
  design — their input arrived by email, at a point where there is no session, so
  gating them on a login would make a confirmation link dead. `confirmSignup` sits
  on the session instead and **signs the customer in**, because its response is a
  full session; React's `useConfirmSignup` returns one the caller has no supported
  way to install.

  **Built with tsup, not ng-packagr.** The package exports only functions
  (`inject*`, `provide*`, `InjectionToken`) and contains no decorators, so it needs
  no Angular compiler. Two independent guards keep it that way: an ESLint rule on
  `Decorator` nodes, and a `check:dist` script that greps the built output for
  `ɵɵngDeclare`, `ɵprov`, `ɵfac` and `__decorate`. CI additionally builds an Angular
  22 example with `ng build --configuration production` and the served bundle
  renders a value read back out of Angular's DI — so the artifact is proven to work
  under AOT, not merely to compile.

  Peers: `@angular/core` and `@angular/common` `>=20.0.0 <23.0.0`,
  `@tanstack/angular-query-experimental` `^5.102.0`. **ESM only** — `@angular/core`
  ships no CommonJS entry and Angular applications always bundle, so a CJS half
  would exist for no consumer.

  **Scope: at parity with the React bindings.** 86 injectables covering 109 of
  React's 111 hooks — catalog, cart, checkout, orders, customer, prices, site,
  shopping lists, reward points, coupons, returns, segments, approvals, cloud
  functions, session attributes and the B2B company context.

  The mapping is deliberately not one-to-one: **31 write operations are grouped
  into 11 mutation bundles**, because a component wants one `isPending` for «the
  shopping list is saving», not five. `injectShoppingListMutations()` replaces five
  React hooks; `injectCompanyMutations()` replaces eleven. Every bundle shares one
  `writeBundle`, so the pending flag, the error signal and the post-write
  invalidation cannot drift between areas.

  Two React hooks have no equivalent, both provider infrastructure rather than
  storefront surface: `useEmporixTelemetry` (a React-Query lifecycle union) and
  `useEmporixErrorHandler` (an error-boundary helper; Angular's equivalent is an
  `ErrorHandler` provider, not a hook). Customer-token auto-refresh and SSO
  (`socialLogin` / `exchangeToken`) remain deliberately absent — the first matches
  React's own default of `false`, the second needs an IdP configured at the tenant.

  **Four places this deviates from React on purpose**, each documented in
  `docs/angular.md`:
  - Customer-scoped reads **gate rather than throw**. React's `useShoppingLists`,
    `useMySegments`, `useApprovals`, `useMyReturns` and the reward-point reads throw
    during render when no token is stored; these issue no request and render empty.
  - Session attributes are written with the **live** context. The endpoint is
    `/session-context/{tenant}/me/context/attributes`, so `me` is whoever the bearer
    is — writing anonymously while signed in lands on a different session.
  - The company switch is a **queue, not a race guard**. Two concurrent switches
    both read the refresh token, and Emporix rotates it server-side, so the second
    would spend one the first consumed.
  - The five company reads key under **their own resources**, where React keys four
    under one `"companies"` key — one shared key means adding a location refetches
    every company panel on the page.

  **Breaking within this release** (nothing published yet, so no consumer is
  affected): the two product searches were crossed against React's names and are
  now `injectProductNameSearch` (term search, `products.searchByName`) and
  `injectProductSearch` (filter search, `products.search`).

  One thing to know before writing your first query: **read signals inside
  `injectQuery`'s options callback, not before it.** Read outside, the cache key and
  the `enabled` gate freeze at construction — the symptom is a customer who logs
  out and still sees their own orders.
