# Examples

Five runnable consumers of the SDK. None is published — they exist to be read
and run. Pick by the question you have.

| I want to see… | Example | Stack |
|---|---|---|
| the SDK without any React | [`node-server`](./node-server) | plain Node + `tsx` |
| the smallest React integration | [`vite-spa`](./vite-spa) | Vite + React Router |
| **a complete storefront** | [`storefront-demo`](./storefront-demo) | Vite + React Router |
| Next with client-side hooks | [`next-app-router`](./next-app-router) | Next 16 App Router |
| Next with **no token in the browser** | [`next-server-first`](./next-server-first) | Next 16 App Router |
| a **Managed Dashboard module** (host-owned token) | [`md-module`](./md-module) | Vite + Module Federation |

## `shared/` is not a demo

[`examples/shared`](./shared) is an unpublished workspace package holding the
Emporix **shape** normalization that `storefront-demo` and `next-server-first`
both need — orders come back in two forms, cart lines want their price row echoed
on update, text fields are sometimes a string and sometimes a locale map. It is a
helper set, not a sixth example, and it has no command to run.

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
there. This is the familiar shape, and React Query gives you caching,
invalidation and optimistic updates for free.

**`next-server-first`** keeps every token in httpOnly cookies. Server Components
read, Server Actions write, and the browser never calls Emporix. There is no
`EmporixProvider` and no storage adapter — nothing in the browser could hold a
token. The cost is real: no React Query for customer data, and roughly one
Server Action per mutation.

Read `next-server-first`'s own README before choosing it. It carries dated
verification tables for every claim it makes, including the ones that turned out
to be wrong.

## The two Vite examples differ in size

**`vite-spa`** is the minimum that works: anonymous catalog browse, customer
login, token in `localStorage`. It is also what the Playwright suite boots —
`e2e/playwright.config.ts` runs it as its `webServer`, so changes here can break
`pnpm e2e`.

**Free port 5173 before running `pnpm e2e`.** The config pins that port with
`reuseExistingServer`, so any other Vite dev server sitting there — for instance
`storefront-demo`, which also defaults to 5173 — gets tested instead of
`vite-spa`. The failure reads like a real regression: `locator('ul li')` expected
12, received 0.

**`storefront-demo`** is the reference: 17 routes across catalog, cart,
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
| `vite-spa` | `pnpm -F @viu/emporix-examples-vite-spa dev` | `VITE_EMPORIX_TENANT` |
| `storefront-demo` | `pnpm -F @viu/emporix-examples-storefront-demo dev` | none — entered in the app |
| `next-app-router` | `pnpm -F @viu/emporix-examples-next-app-router dev` | `NEXT_PUBLIC_EMPORIX_TENANT` |
| `next-server-first` | `pnpm -F @viu/emporix-examples-next-server-first dev` | `.env.local`, see its `.env.example` |
| `md-module` | `pnpm -F @viu/emporix-examples-md-module dev` | `.env.local` — `VITE_API_URL`, `VITE_DEMO_TENANT`, `VITE_DEMO_LANGUAGE`, `VITE_DEMO_TOKEN`; see its [README](./md-module/README.md) |

`node-server`, `vite-spa` and `next-app-router` fall back to the tenant
`mytenant`, which does not exist — set the variable or you get 404s that look
like bugs. `next-server-first` instead **throws** with the variable name in the
message, which is the better behaviour and worth copying.

`next-server-first` is also the only one needing a real `.env.local`: it holds a
storefront client id server-side, so it cannot take it from the URL or a form.

## Conventions

- **Not published.** `@viu/emporix-examples-*` are listed under `ignore` in
  `.changeset/config.json`; they are never versioned or released.
- **They typecheck against `dist/`,** not against package sources. After
  changing SDK or React source, run
  `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build`
  before `pnpm -F @viu/emporix-examples-* typecheck`.
- **Almost no unit tests.** `test` and `lint` are deliberate no-ops in four of the
  five; examples are verified by typecheck, by build, and by running them. The
  exception is `next-server-first`, whose `test` really runs vitest over two files:
  `tests/safe-next.test.ts` covers an open redirect, and
  `tests/strip-html.test.ts` covers a ReDoS CodeQL found in `shared/`. Both are
  trust or availability boundaries, and both are worth a handful of assertions even
  in a demo. Nothing else here is unit-tested, on purpose.
- **Not every product has a price**, and Emporix requires a `priceId` on
  internal cart items. Examples that add to a cart resolve the price first; the
  Next ones list a category known to carry prices on the `viu` tenant.
