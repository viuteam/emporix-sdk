# `@viu/emporix-sdk-angular`: an Angular package without the Angular compiler

**Status:** design, not implemented.
**Scope:** a new `packages/angular`, plus a move of already-framework-agnostic code
down into `packages/sdk`. `packages/react` gains re-exports and no behaviour change.

## The situation

The workspace ships bindings for React (`packages/react`, 107 exported hooks) and
Next (`packages/next`). There is no Angular story, and Angular is the third
framework a storefront consumer is likely to arrive with.

The naive read of that task is "port the React package". Measured, `packages/react`
has 73 files under `src/`, of which **57 import `react`, `react-dom` or
`@tanstack/react-query`** and 16 do not. So the port is 57 files of re-authoring
and a 107-symbol public surface — not a two-week job, and worth cutting
deliberately rather than discovering the size halfway through.

## The constraint that usually shapes this design, and why it does not

An Angular library normally means `ng-packagr`: a second build toolchain beside
the four `tsup` packages here, a different output format (partial-Ivy FESM), and a
different mental model for everyone touching the repo.

That premise was tested rather than assumed. `@tanstack/angular-query-experimental@5.102.3`
is a real, widely-used Angular library; its published tarball was unpacked and
searched:

```
ɵɵngDeclare | ɵprov | ɵfac   → 0 matches in index.mjs
Injectable  | __decorate     → 0 matches in index.mjs
```

It ships plain per-file ESM with relative imports and no Angular-compiler output
at all. Its `exports` map is flat (`"." → "./index.mjs"`), not the FESM layout
`ng-packagr` produces.

**An Angular library that exports only functions — `inject*`, `provide*`,
`InjectionToken` — does not need the Angular compiler.** The compiler is required
for decorators and templates: `@Injectable()`, `@Component()`, `@Directive()`,
`@Pipe()`, `@NgModule()`. A library with none of those compiles with `tsc`, and
therefore with `tsup`.

That keeps the workspace on one build tool. The price is a rule with no
exceptions, and rules without enforcement decay — see [Enforcing the
rule](#enforcing-the-rule).

## Design

### Package shape

| | |
|---|---|
| name | `@viu/emporix-sdk-angular` |
| peers | `@angular/core` + `@angular/common` `>=20.0.0 <23.0.0`, `@tanstack/angular-query-experimental ^5.102.0`, `@viu/emporix-sdk workspace:^` |
| dev | Angular 22.1.x (`@angular/core` latest is 22.1.3, published 2026-08-19) |
| format | **ESM only** |
| entries | `.`, `./storage`, `./ssr` |
| build | `tsup`, `sideEffects: false`, `type: module` |

**Three peers' majors, mirroring React.** `packages/react` declares
`react: "^18.0.0 || ^19.0.0"` — two majors of headroom. Angular ships two majors a
year, so `>=20 <23` covers v20-LTS, v21-LTS and current v22, which is the same
posture. It costs only v22-only APIs (`debounced`, `injectAsync`, `Service`), none
of which this design uses. The TanStack adapter's own peer floor is
`@angular/core >=16.0.0`, so it never binds.

**ESM only, deliberately not dual.** The other four packages ship ESM + CJS.
`@angular/core` publishes no `main` — only `module` and an `exports.default`
pointing at `.mjs` — and the TanStack Angular adapter is ESM-only too. Angular
applications always bundle. A CJS half would exist for no consumer, so it is
omitted rather than copied.

**Three entries, not five.** React's five entries exist because the `"use client"`
banner has to be applied per entry, and `packages/react/scripts/check-dist.mjs`
guards exactly that boundary. Angular has no RSC boundary, so the split has no
purpose. `./storage` and `./ssr` remain separate because they have genuinely
different environments (browser globals; server-side hydration state).

### Six primitives

```ts
provideEmporix(config): EnvironmentProviders
injectEmporix(): { client: EmporixClient; storage: EmporixStorage }
emporixQueryOptions(cfg): CreateQueryOptions      // pure, no injection context
injectEmporixQuery(cfg, opts?: { injector?: Injector })
injectEmporixInfinite(cfg, opts?: { injector?: Injector })
storageSignal(storage, key): Signal<T | null>
```

**`provideEmporix` composes `provideTanStackQuery` internally.** React's
`EmporixProvider` renders `QueryClientProvider` itself with a fallback
`QueryClient` and an optional `queryClient` prop
([`provider.tsx:48`](../../../packages/react/src/provider.tsx)); the Angular
analogue returns `makeEnvironmentProviders([...ours, provideTanStackQuery(qc)])`.
One call, same ownership model.

**Splitting `emporixQueryOptions` out of `injectEmporixQuery` is where Angular
comes out ahead of React.** The auth resolution, query key and `enabled` gate
become a pure function that takes signal values and returns options — directly
unit-testable with no DI container and no fake component. `useEmporixQuery`
cannot be split that way, because the Rules of Hooks force the `useQuery` call
into the same function body as the `useCustomerToken()` and `useReadSite()` reads.
The Angular version is a strictly better shape, not a translation.

**`storageSignal` replaces `useSyncExternalStore`.** React bridges storage into
render via `useSyncExternalStore` over `storage.subscribeAll`
([`use-storage-snapshot.ts`](../../../packages/react/src/hooks/internal/use-storage-snapshot.ts));
the comment there records why raw `storage.getCustomerToken()` reads in hook
bodies were wrong — `enabled` gates stayed stale until an unrelated re-render.
The same hazard exists in Angular, so the same fix does: a `signal` fed by the
subscription, torn down through `DestroyRef`.

This is the load-bearing primitive. `injectQuery` runs its options function in a
reactive context, so a signal read inside it re-derives the key and the `enabled`
gate on login and logout. Without `storageSignal` the gates freeze, and the bug
is invisible until a customer logs out and still sees their orders.

**The optional `{ injector }` escape hatch is copied from the adapter, not
invented.** `injectQuery` in the published `inject-query.mjs`, de-minified:

```js
!(options?.injector) && assertInInjectionContext(injectQuery)
return runInInjectionContext(options?.injector ?? inject(Injector), () => ...)
```

Our injectables mirror that signature exactly, so a consumer calling them outside
an injection context gets the framework's own error and the framework's own way
out, rather than a second convention to learn.

### Context becomes signals, not contexts

Site, company and telemetry state move from React contexts to `Signal`s behind
`InjectionToken`s. The site context is the largest piece — 243 lines in React,
carrying `siteCode`, `currency`, `language`, async `setSite`/`setCurrency`/`setLanguage`,
`isSwitching` and `switchError`.

**Telemetry is a `provideEmporix` option, not a module-scope setter.** The
`next` package chose module scope for `setEmporixErrorReporter` because
`getEmporixClient` is memoized on a string key and a function cannot be keyed —
that was a constraint, not a preference. Angular's DI *is* the registry; the
constraint does not exist here, and reproducing the workaround would be cargo
cult.

### The cut: 33 injectables

Every name below was checked against `packages/react/src/hooks/index.ts`; all 33
exist there, and 33 + 74 = 107 exactly.

| Area | Count | Contents |
|---|---|---|
| Catalog | 11 | `product`, `products`, `productsInfinite`, `productByCode`, `productSearch`, `productMedia`, `category`, `categories`, `categoryTree`, `productsInCategory`, `productsInCategoryInfinite` |
| Prices + availability | 3 | `matchPrices`, `matchPricesChunked`, `availability` |
| Cart | 5 | `cart`, `activeCart`, `cartMutations`, `createCart`, `cartItems` |
| Checkout + shipping | 4 | `checkout`, `paymentModes`, `initializePayment`, `shippingZones` |
| Customer + orders | 8 | `customerSession`, `updateCustomer`, `customerAddresses`, `addressMutations`, `passwordReset`, `myOrders`, `myOrdersInfinite`, `order` |
| Site | 2 | `sites`, `activeSite` |

**The excluded 74, counted rather than glossed over:**

| Area | Count | Area | Count |
|---|---|---|---|
| companies / B2B | 17 | reward points | 4 |
| customer account extras | 10 | approvals | 4 |
| catalog extras | 9 | returns | 3 |
| segments | 7 | coupons | 2 |
| shopping lists | 6 | cloud functions | 2 |
| orders extras | 5 | other | 5 |

They follow the same pattern as the 33, so adding them is mechanical rather than
architectural. `docs/angular.md` must state the gap with these numbers. A doc that
lists what exists and stays silent about what does not reads as complete, and the
consumer discovers the gap by failing to import.

**Two things the count surfaced that the cut got wrong:**

`useSiteContext` lands in the excluded 74 but is not actually excluded — it is the
accessor this design replaces with a signal-backed `injectSiteContext` in phase 3.
It is counted as excluded above because that is what the mechanical partition says;
the honest total of genuinely-absent symbols is 73.

More consequentially, **`useChangePassword`, `useConfirmSignup`,
`useResendActivation`, `useChangeEmail` and `useConfirmEmailChange` sit outside the
cut**, in "customer account extras". A storefront with a login also has signup
confirmation and password change. The cut was reasoned from what a catalog and
checkout render, and it under-serves account management. Either phase 7 absorbs
those five, or `docs/angular.md` says plainly that account management is
incomplete.

**Resolved (2026-08-25): the five shipped.** They are `injectCustomerCredentials`
plus `confirmSignup` on the session, which brings the excluded set to 69. The
numbers above are the design-time figures and are left as written; `docs/angular.md`
carries the current ones. The implementation also settled a question this section
did not ask: the five do not share one auth model — two require a customer and
three are anonymous, because their input arrives by email at a point where no
session exists.

### What moves down into `packages/sdk`

The repo has already established this pattern twice, and written down why. From
[`packages/react/src/storage/keys.ts`](../../../packages/react/src/storage/keys.ts):

> the same strings are cookie names on a server, Web Storage keys in a browser,
> and record fields in a session store, so the contract does not belong to the
> React bindings. […] A copy here would be a second source of truth for the one
> thing that must not drift.

Already in the SDK and therefore free for Angular: `EmporixStorage`,
`parseAnonymousSession`, `createCookieBackedStorage`, `createServerStorage`,
`serverAuth` ([`core/session-storage.ts`](../../../packages/sdk/src/core/session-storage.ts),
233 lines) and `STORAGE_KEYS` ([`core/session-keys.ts`](../../../packages/sdk/src/core/session-keys.ts)).

Still to move, by the same argument:

| From `packages/react/src/` | Size | Why it is not a React concern |
|---|---|---|
| `storage/memory.ts`, `local-storage.ts`, `session-storage.ts`, `cookie.ts`, `web-storage.ts`, `cookie-core.ts` | 251 lines | Pure DOM. `localStorage` is not a React API. |
| `hooks/internal/query-keys.ts` | 60 lines | The key shape must be identical across frameworks or docs, devtools and invalidation drift apart. |
| `hooks/internal/customer-session-store.ts` | 75 lines | A subscribe/snapshot store. React consumes it; it is not React. |

React re-exports all of it, so no consumer import breaks and there is exactly one
definition — the same shape the two prior moves took.

### Enforcing the rule

"No decorators, ever" survives precisely as long as the first person who wants a
convenience pipe. So it gets a test, modelled on
[`packages/react/scripts/check-dist.mjs`](../../../packages/react/scripts/check-dist.mjs),
which guards React's `"use client"` banners the same way:

`packages/angular/scripts/check-dist.mjs` greps the built `dist/` for
`ɵɵngDeclare`, `ɵprov`, `ɵfac` and `__decorate`, and fails on any match. It runs
in `pr-check.yml` next to the existing React check. The probe is exactly the one
used above to establish the premise, turned into a regression test.

## Testing

Vitest with `environment: "jsdom"` and MSW, as everywhere else in the workspace.
`emporixQueryOptions` being a pure function means the auth/key/gate logic — the
part most likely to be wrong — is tested without any Angular machinery at all.

For the `inject*` wrappers there is an **open question this document cannot
settle**: whether `Injector.create` plus `runInInjectionContext` suffices, or
whether `TestBed` is required. `injectQuery` creates an `effect()` internally, and
effects need a scheduler; without an `ApplicationRef` they may never flush, in
which case a test would observe a query that never resolves and look like a
product bug. If `TestBed` is needed, zone.js versus `provideZonelessChangeDetection()`
is a second decision behind it. This is measured in phase 1, not decided here.

Beyond that, the tests worth naming up front:

- **`storageSignal` reacts.** Write a customer token into storage after the signal
  is created, assert the dependent `enabled` gate flips. This is the bug class the
  React comment documents, and the one most likely to be silently reintroduced.
- **Query-key parity with React.** Given the same resource, args, tenant,
  `authKind`, site and language, `emporixQueryOptions` and `emporixKey` must
  produce the identical key. Asserted directly against the React helper, so a
  later change to one side fails rather than diverging quietly.
- **Customer-gated reads stay disabled without a token**, and anonymous-or-customer
  reads key differently per `authKind` — the two behaviours `useEmporixQuery`
  encodes.
- **No decorators in `dist/`** (above).

## Deliberately not in scope

- **No Next-equivalent package.** The value of `packages/next` is cache tags,
  `revalidateTag` and RSC boundaries — Next concepts with no Angular counterpart.
  Angular SSR has no tag-based invalidation model; its analogue to
  `packages/react/src/ssr.ts` is `TransferState`/`makeStateKey`, both exported from
  `@angular/core` 22, and that is an entry in this package rather than a second
  package.
- **No components, directives or pipes.** Not a style preference — shipping one
  pulls in `ng-packagr` and invalidates the toolchain decision above. React's one
  component, `EmporixErrorBoundary`, maps to a plain class behind
  `{ provide: ErrorHandler }`, which needs no decorator.
- **Not TanStack Query v4.** Checked, because it was asked: the Angular adapter
  has **315 published versions and every one is major 5**, the earliest being
  5.12.1 (2023-12-01), two months after 5.0.0 shipped. react-query, vue-query and
  svelte-query have 113, 90 and 49 4.x versions respectively; Angular has zero.
  The adapter was born inside the v5 line. Choosing v4 would mean writing the
  reactivity bridge ourselves against `query-core@4` — owning the hardest part of
  the adapter, without devtools, on the older core. (v4 is not abandoned:
  `react-query@4.44.0` shipped 2026-04-01. The objection is the missing adapter,
  nothing else.)
- **Not Angular's native `resource()`**, though it is stable in v22 —
  `core.d.ts:7428`, with only `resourceFromSnapshots` marked `@experimental`. It
  has no cross-component cache, no invalidation target after a cart mutation, and
  no infinite pagination. The React package's architecture *is* the query-key and
  invalidation graph; on `resource()` we would rebuild react-query, worse.
- **No agnostic-core-plus-thin-adapters refactor.** The right long-term shape,
  and a refactor of 107 hooks and 69 test files in a published package. Not
  justified by one new binding.
- **`packages/next` untouched.**

## Repo changes this requires

- **`commitlint.config.js`: add `angular` to `scope-enum`.** Its 21 current scopes
  do not include it, and `.husky/commit-msg` rejects unknown scopes — so *every*
  commit of this series fails until this lands. It belongs in the first commit.
- **`pr-check.yml`:** add the decorator check and a production AOT build of the
  example app. The `node: [20, 22, 24]` matrix stays, but the AOT step must be
  **skipped on Node 20**.

  *Corrected after implementation.* This section originally claimed the Node
  floor was only a warning, because Angular 22 declares
  `engines.node: ^22.22.3 || ^24.15.0 || >=26.0.0` and `.npmrc` sets no
  `engine-strict`. Two of the three halves of that hold: `pnpm install` warns
  rather than fails, and `tsc`/`vitest` genuinely do not care —
  `packages/angular`'s unit tests pass on Node 20. But **the Angular CLI checks
  the version itself and exits before building**, which was found by running it:
  on Node v24.11.1 it refused with "requires a minimum Node.js version of
  v22.22.3 or v24.15.0 or v26.0.0". So the AOT step is gated with
  `if: matrix.node != '20'`, and the matrix carries a comment saying why.
- **`.changeset/config.json`:** unchanged. `linked` pairs `@viu/emporix-sdk` with
  `@viu/emporix-sdk-react` only; Angular stays uncoupled, like `next`.
- **Docs:** new `docs/angular.md`; workspace table in `CLAUDE.md`; root `README.md`;
  `examples/README.md`.
- **`packages/angular/LICENSE`** must exist. `packages/mixins` declared `license`
  and listed `LICENSE` in `files` for several releases without the file being
  there; the new package should not repeat it.

## Phases

The order is driven by risk, not by dependency: phase 1 exists to falsify the
toolchain premise before anything is built on it.

| # | Content |
|---|---|
| 1 | Scaffold, `provideEmporix`, `injectEmporixQuery`, `storageSignal`, `examples/angular-storefront`, **production AOT build in CI**, decorator guard, test-setup question settled |
| 2 | Move to `packages/sdk` + re-exports from `packages/react` |
| 3 | Signal foundation: site context, customer session, telemetry, token refresher |
| 4 | Catalog (11) |
| 5 | Prices/availability (3) + cart (5) |
| 6 | Checkout (4) + site (2) |
| 7 | Customer + orders (8), plus the five account-management hooks if that decision lands |
| 8 | `docs/angular.md`, READMEs, example app fleshed out, e2e |

One changeset per PR. The package starts at `0.x` under `minor`, as `next` did.

**Status (2026-08-25): phases 1–7 are done and phase 8 is partial.** Phases 4–7
landed directly rather than through their own plan — see the resolution note in
[the implementation plan](../plans/2026-08-25-angular-package-foundation.md). Of
phase 8, the docs, the READMEs and the example app are complete; **the e2e suite is
not**. `e2e/playwright.config.ts` boots `examples/vite-spa` only, so no CI job
drives the Angular storefront through a browser. Everything Angular-side has been
verified by hand against the `viu` tenant instead, up to and including a placed
order — which is evidence, but not a regression gate.

## Assumptions to verify before implementing

- ~~**The AOT production build is the whole premise and has not been run.**~~
  **Run and confirmed** (2026-08-25). `examples/angular-storefront` on Angular
  22.1.5 builds with `ng build --configuration production` — 352.86 kB raw /
  79.27 kB transfer — and the served bundle renders values that only exist if
  `provideEmporix`'s `InjectionToken`s resolved at runtime, with no console
  errors. The `/storage` subpath entry resolves through a consumer's bundler too.
  A `tsup`-built, decorator-free Angular library needs no `ng-packagr`.

  One warning appears in that build, and it is **not** from this package:
  `packages/sdk/dist/index.js` carries a bare `import './chunk-….js'` that
  esbuild drops because the SDK declares `sideEffects: false`. Building the SDK
  from the pre-move commit produces the identical bare import at the identical
  line with the identical chunk hash, so it predates this work. It is benign —
  the chunk holds only `requireCustomer` and has no side effects to run.

- **Angular 22 requires TypeScript 6.** `@angular/compiler-cli@22.1.3` peers
  `typescript: ">=6.0 <6.1"` while the workspace is on 5.9.3. Discovered when the
  CLI generated the example with `typescript: ~6.0.2`. It is contained: only
  `examples/angular-storefront` declares TS 6, and `packages/angular` typechecks
  against Angular 22's declarations with the workspace's 5.9 without complaint.
  That is a fragility rather than a problem — a future Angular minor could emit
  declarations 5.9 cannot read, and the fix then is to raise the workspace's
  TypeScript, not to special-case the package.
- **The test harness is unresolved** — `Injector.create` or `TestBed`; see
  Testing. A wrong guess here shows up as tests that hang rather than tests that
  fail.
- **`-experimental` in the adapter's name is a real but smaller risk than it
  looks.** Evidence in its favour: 9 releases in the last 90 days, exact version
  lockstep with `@tanstack/react-query` (both 5.102.3), and — the useful signal —
  `@tanstack/svelte-query` is at major **6.1.43** while depending on
  `@tanstack/query-core@5.102.3`. Adapter majors move independently of the core,
  so a future `angular-query` v6 would be an Angular-shaped change, not a core
  rewrite. Not verified: the adapter's actual breaking-change history across its
  315 releases.
- **The 33-injectable cut is judgement, not data.** It is what a storefront
  renders, reasoned from `examples/storefront-demo`'s 17 routes. Nobody has
  checked it against a real Angular consumer's requirements, because there is no
  such consumer yet — this is coverage work, not customer work. The first real
  consumer will want something from the excluded 74.
- **Whether the five account-management hooks join phase 7.** Counting the cut
  mechanically is what exposed the hole; it was not visible while the areas were
  described in prose. Adding them makes the cut 38 and phase 7 the largest phase.
  This is the one scope question in the document that is still open, and it is a
  product call rather than a technical one.
- **Nothing here has been run against Angular at all.** No Angular dependency is
  installed in this workspace today. Every claim about the framework comes from
  `@angular/core@22.1.3`'s published type definitions and the TanStack adapter's
  published source.
