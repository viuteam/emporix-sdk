# Examples

Eight runnable consumers of the SDK. None is published — they exist to be read
and run. Pick by the question you have.

| I want to see… | Example | Stack |
|---|---|---|
| the SDK without any React | [`node-server`](./node-server) | plain Node + `tsx` |
| the smallest React integration | [`vite-spa`](./vite-spa) | Vite + React Router |
| **a complete storefront** | [`storefront-demo`](./storefront-demo) | Vite + React Router |
| Next with client-side hooks | [`next-app-router`](./next-app-router) | Next 16 App Router |
| Next with **no token in the browser** | [`next-server-first`](./next-server-first) | Next 16 App Router |
| a **Managed Dashboard module** (host-owned token) | [`md-module`](./md-module) | Vite + Module Federation |
| the smallest Angular integration | [`angular-storefront`](./angular-storefront) | Angular 22 + `@angular/build` |
| **a complete Angular storefront** | [`angular-storefront-demo`](./angular-storefront-demo) | Angular 22 + signals |

## `angular-storefront` is a test rig, not a demo

It is the one example whose job is not to show you how to build something.
`@viu/emporix-sdk-angular` is built with tsup rather than `ng-packagr`, on the
premise that a decorator-free Angular library needs no Angular compiler. This app
exists so `ng build --configuration production` proves that on every PR against
`main`, and so that a value only obtainable through Angular's DI is rendered
rather than merely compiled. Read its README before copying anything from it.

## `shared/` is not a demo

[`examples/shared`](./shared) is an unpublished workspace package holding the
Emporix **shape** normalization that `storefront-demo`, `next-server-first` and
`angular-storefront-demo` all need — orders come back in two forms, cart lines
want their price row echoed on update, text fields are sometimes a string and
sometimes a locale map. It is a helper set, not a ninth example, and it has no
command to run.

Building your own storefront? Copy the files. They are deliberately not part of
the published API, for the same reason
[`next-server-first/app/session-store.ts`](./next-server-first/app/session-store.ts)
says «copy it».

## The two Next examples differ in one decision

They are not two versions of the same thing — they are the two ways to build a
Next storefront, and the choice is architectural.

**`next-app-router`** renders the catalog on the server and runs cart and
customer flows in the browser with `@viu/emporix-sdk-react` hooks. The customer
token has to be readable by JavaScript, because the code that uses it runs
there. This is the familiar shape, and React Query gives you caching and
invalidation for free. A cart write is a command chain (`useCartCommands`) that
ends in `GetCart`, so the cart Emporix returns lands in the cache: no optimistic
guess, and no refetch.

**`next-server-first`** keeps every token in httpOnly cookies. Server Components
read, Server Actions write, and the browser never calls Emporix. There is no
`EmporixProvider` and no storage adapter — nothing in the browser could hold a
token. The cost is real: no React Query for customer data, and roughly one
Server Action per mutation.

Read `next-server-first`'s own README before choosing it. It carries dated
verification tables for every claim it makes, including the ones that turned out
to be wrong.

## The two Vite storefronts differ in size

**`vite-spa`** is the minimum that works: anonymous catalog browse, customer
login with the token in `localStorage`, order history and detail, a B2B company
switcher and a telemetry HUD. Its `/guest` page runs a guest checkout that
**places a real order** on the configured tenant —
`e2e/specs/guest-checkout.spec.ts` places one on every run. It is also what the
Playwright suite boots — `e2e/playwright.config.ts` runs it as its `webServer`,
so changes here can break `pnpm e2e`.

**Free port 5173 before running `pnpm e2e`.** The config pins that port with
`reuseExistingServer`, so any other Vite dev server sitting there — for instance
`storefront-demo`, which also defaults to 5173 — gets tested instead of
`vite-spa`. The failure reads like a real regression: `locator('ul li')` expected
12, received 0.

**`storefront-demo`** is the reference: 18 routes across catalog, cart,
checkout and account. You type a tenant and a public storefront client id
into the running app rather than configuring env — it drives a real tenant with
no secrets. When you need to know how a flow is *actually* wired, this is the
one to read.

## Running them

```bash
pnpm install
pnpm -r --filter "./packages/*" build   # examples typecheck against dist/
```

| Example | Command | Configuration |
|---|---|---|
| `node-server` | `pnpm -F @viu/emporix-examples-node-server start` | a `.env` file — `EMPORIX_TENANT`, `EMPORIX_BACKEND_CLIENT_ID`, `EMPORIX_BACKEND_CLIENT_SECRET`, `EMPORIX_STOREFRONT_CLIENT_ID` |
| `vite-spa` | `pnpm -F @viu/emporix-examples-vite-spa dev` | `VITE_EMPORIX_TENANT`, `VITE_EMPORIX_STOREFRONT_CLIENT_ID` |
| `storefront-demo` | `pnpm -F @viu/emporix-examples-storefront-demo dev` | none — entered in the app |
| `next-app-router` | `pnpm -F @viu/emporix-examples-next-app-router dev` | `NEXT_PUBLIC_EMPORIX_TENANT`, `NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID` |
| `next-server-first` | `pnpm -F @viu/emporix-examples-next-server-first dev` | `.env.local`, see its `.env.example` |
| `md-module` | `pnpm -F @viu/emporix-examples-md-module dev` | none — hosts are committed per mode in `src/environments.ts`; `.env.local` optionally supplies `VITE_DEMO_TENANT` / `VITE_DEMO_LANGUAGE` / `VITE_DEMO_TOKEN`, see its [README](./md-module/README.md) |
| `angular-storefront` | `pnpm -F @viu/emporix-examples-angular start` | none — it calls no API; the tenant is fixed in `src/app/app.config.ts` |
| `angular-storefront-demo` | `pnpm -F @viu/emporix-examples-angular-storefront start` | none — entered in the app |

The two Angular examples also need `@viu/emporix-sdk-angular`'s `dist/` (the
build above includes it; on its own, `pnpm -F @viu/emporix-sdk-angular build`) and
a Node version the Angular CLI accepts — `^22.22.3 || ^24.15.0 || >=26.0.0`. It
exits on anything older.

`node-server`, `vite-spa` and `next-app-router` fall back to the tenant
`mytenant`, which does not exist — set the variable or you get 404s that look
like bugs. `next-server-first` instead **throws** with the variable name in the
message, which is the better behaviour and worth copying.

`next-server-first` is also the only one whose configuration belongs in a
`.env.local` file: it holds the storefront client id and a cookie secret
server-side, so neither can come from the URL or a form.

## Conventions

- **Not published.** `@viu/emporix-examples-*` are listed under `ignore` in
  `.changeset/config.json`; they are never versioned or released.
- **They typecheck against `dist/`,** not against package sources. After
  changing SDK, React or Angular source, rebuild what changed —
  `pnpm -F @viu/emporix-sdk build`, `pnpm -F @viu/emporix-sdk-react build`,
  `pnpm -F @viu/emporix-sdk-angular build` — before
  `pnpm -F @viu/emporix-examples-* typecheck`.
- **Unit tests in two of the eight.** `next-server-first` and `md-module` run
  real vitest suites, and the root `pnpm test` runs both alongside the packages.
  `next-server-first`'s suite includes `tests/safe-next.test.ts` (an open
  redirect) and `tests/strip-html.test.ts` (a ReDoS CodeQL found in `shared/`);
  `md-module` covers its brand and label hooks and its environment resolver. In
  `node-server`, `vite-spa`, `storefront-demo` and `next-app-router`, `test` and
  `lint` are deliberate no-ops, and the two Angular examples have neither script;
  those are verified by typecheck, by build, and by running them.
  `next-server-first`'s `lint` is a no-op too, and `md-module` has no `lint`.
- **Not every product has a price**, and Emporix requires a `priceId` on
  internal cart items. Examples that add to a cart resolve the price first.
  `next-server-first`'s home page lists a category known to carry prices on the
  `viu` tenant (`PRICED_CATEGORY`); `next-app-router` lists the first twelve
  products and adds one fixed product that has a price (`DEMO_PRODUCT_ID` in
  `app/site.ts`).
