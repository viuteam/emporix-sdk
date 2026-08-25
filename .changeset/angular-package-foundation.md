---
"@viu/emporix-sdk-angular": minor
---

feat(angular): add Angular bindings — provideEmporix, injectEmporixQuery, site and customer-session signals

First release of `@viu/emporix-sdk-angular`. One `provideEmporix()` wires the SDK,
a storage backend and TanStack Query into an Angular application;
`injectEmporixQuery` and `injectEmporixInfinite` run reads with the same cache
keys, auth resolution and `enabled` gating as the React bindings — literally the
same key builder, asserted by test over four site/token combinations.

Also in this release: the site context as signals with `setSite` / `setCurrency` /
`setLanguage` (optimistic, with `switchError` and no rollback), and
`injectCustomerSession` with login, signup, logout and `refreshSession` — login
included, meaning guest-cart merge and `preferredSite` handling, not just a token
write.

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

**Scope.** This is the foundation, not the full surface. The 33 injectables that
mirror React's catalog, cart, checkout and order hooks are planned but not here;
`docs/angular.md` names the excluded areas with counts rather than leaving you to
find the gap by failing to import. Telemetry, customer-token auto-refresh, SSO
(`socialLogin` / `exchangeToken`) and the B2B company context are deliberately
absent, each for a stated reason.

One thing to know before writing your first query: **read signals inside
`injectQuery`'s options callback, not before it.** Read outside, the cache key and
the `enabled` gate freeze at construction — the symptom is a customer who logs
out and still sees their own orders.
