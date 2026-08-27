# @viu/emporix-sdk-angular

[![CI](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml)
[![npm](https://img.shields.io/npm/v/@viu/emporix-sdk-angular)](https://www.npmjs.com/package/@viu/emporix-sdk-angular)

Angular bindings for `@viu/emporix-sdk`, built on
[`@tanstack/angular-query-experimental`](https://tanstack.com/query) v5. Supports
Angular 20 – 22.

One `provideEmporix()` wires the SDK, a storage backend and TanStack Query into an
application; 86 signal-based `inject*` functions run the reads and writes with the
same cache keys and auth resolution as the React bindings — literally the same key
builder, asserted by test.

## Install

```bash
pnpm add @viu/emporix-sdk-angular @viu/emporix-sdk @tanstack/angular-query-experimental
```

`@viu/emporix-sdk`, `@tanstack/angular-query-experimental`, `@angular/core` and
`@angular/common` are peer dependencies. Angular peers are
`>=20.0.0 <23.0.0`.

**ESM only.** `@angular/core` ships no CommonJS entry and Angular applications
always bundle, so a CJS half would exist for no consumer.

## Setup

```ts
// app.config.ts
import { EmporixClient } from "@viu/emporix-sdk";
import { provideEmporix } from "@viu/emporix-sdk-angular";
import { createLocalStorage } from "@viu/emporix-sdk-angular/storage";

const client = new EmporixClient({
  tenant: "mytenant",
  credentials: {
    storefront: {
      clientId: "your-storefront-client-id",
      context: { currency: "CHF", siteCode: "main", targetLocation: "CH" },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [provideEmporix({ client, storage: createLocalStorage() })],
};
```

`provideEmporix` composes `provideTanStackQuery` itself — one call, one ownership
model. Pass your own `queryClient` to share one cache with the host application.

Create the `EmporixClient` **once** per application, never per component.

## The one rule

**Read signals inside the options callback, not before it.**

```ts
export class ProductPage {
  id = signal("p1");
  product = injectProduct(this.id); // re-keys and refetches when `id` changes
}
```

TanStack's `injectQuery` runs that callback in a reactive context, so the cache key
and the `enabled` gate follow login, logout and a site switch. Read a signal
*outside* it and both freeze at construction time — the symptom is a customer who
logs out and still sees their own orders.

## Usage

```ts
export class Shop {
  private site = injectEmporixSite(); // siteCode, currency, language as signals
  session = injectCustomerSession(); // login, signup, logout, refreshSession

  products = injectProductsInfinite(signal(24));
  cart = injectActiveCart({ create: true }); // bootstraps one if needed
  mutations = injectCartMutations(); // resolves the cart id at call time

  add(itemYrn: string) {
    return this.mutations.addItem({ itemYrn, quantity: 1, price: /* … */ });
  }
}
```

Writes are grouped per area rather than one injectable per operation, so a
component gets one `isPending` and one `error` for «the cart is saving» instead of
five. Every bundle shares one internal write path, so the pending flag, the error
signal and the post-write invalidation cannot drift between areas.

## What is covered

| Area | Injectables |
|---|---|
| Catalog | 20 — products, categories, both searches, media, variants, infinite reads |
| Cart | 6 — read, items, validation, bootstrap, create, mutations |
| Checkout | 5 — payment modes, shipping zones, place order, initialize payment |
| Customer | 5 — profile, addresses, address mutations, password reset |
| Orders | 5 — mine, infinite, one, sales order, mutations (cancel/transition/reorder) |
| Prices | 4 — match, chunked match, availability, bulk availability |
| Site | 3 — list, active, default |
| B2B | 8 — company context, switch, four reads, mutations |
| Segments | 7 |
| Loyalty | 5 — reward points, redeem options, redemption, coupons |
| Returns | 3 |
| Approvals | 3 |
| Shopping lists | 2 |
| Other | 3 — cloud functions, session attributes |

Plus seven primitives: `injectEmporix`, `injectEmporixQuery`,
`injectEmporixInfinite`, `injectEmporixSite`, `injectEmporixSiteSwitch`,
`injectCustomerSession`, `injectCustomerCredentials`.

That covers **109 of the React package's 111 hooks**. The two without an
equivalent are `useEmporixTelemetry` and `useEmporixErrorHandler` — both React
provider infrastructure rather than storefront surface. Four places deviate from
React on purpose; each is named with its reason in
[`docs/angular.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/angular.md).

## Why no `ng-packagr`

The package exports only functions — `inject*`, `provide*`, `InjectionToken` — and
holds **no decorators**, so it needs no Angular compiler and builds with tsup like
every other package in the workspace.

Two guards keep that true: an ESLint rule rejecting any `Decorator` node, and a
`check:dist` script that greps the built output for `ɵɵngDeclare`, `ɵprov`, `ɵfac`
and `__decorate`. CI additionally builds an Angular 22 example with
`ng build --configuration production`, so the artifact is proven to work under AOT
rather than merely to compile.

The consequence for consumers: none. The consequence for contributors: no
components, directives, pipes or NgModules in this package.

## Subpath exports

`.`, `./storage`, `./ssr`.

`./ssr` re-exports Angular's `TransferState` and `makeStateKey` for hydrating a
server-rendered query result. There is deliberately no analogue to
`@viu/emporix-sdk-next`'s cache tags — `revalidateTag` and RSC boundaries are Next
concepts with no Angular counterpart.

## Changelog

npmjs.com renders only this README, never a changelog — the registry has no field
for one. The per-version history lives here instead:

- [`CHANGELOG.md`](https://github.com/viuteam/emporix-sdk/blob/main/packages/angular/CHANGELOG.md)
  — the whole history in one file. Also shipped inside the published tarball, so
  [unpkg serves it](https://unpkg.com/@viu/emporix-sdk-angular/CHANGELOG.md)
  straight from the release artifact.
- [Releases](https://github.com/viuteam/emporix-sdk/releases) — one entry per
  published version, each linking the PR and the commit behind every change.

## Authors

- **Dominic Fritschi** — _Maintainer_ — [VIU](https://www.viu.ch)
- **Andreas Nebiker** — _Contributor_ — [VIU](https://www.viu.ch)
- The **Team at VIU** — _Contributors_ — [VIU](https://www.viu.ch)

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
