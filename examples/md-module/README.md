# Managed Dashboard module

A Module Federation remote for the Emporix Managed Dashboard, wired to
`@viu/emporix-sdk-react` with a **host-owned** customer token.

Upstream, Emporix ships [`emporix/md-module-template`](https://github.com/emporix/md-module-template).
The dashboard loads the remote and passes one object:

```ts
type AppState = { tenant: string; language: string; token: string }
```

The module never authenticates. That `token` is a customer token whose scopes reach
operations a storefront token could not, which is what makes the React package usable here
at all — see the [Managed Dashboard section](../../packages/react/README.md#managed-dashboard-module-host-owned-token)
for the full recipe and the five things to get right.

## What this example does differently from the upstream template

- **No `@emporix/component-library`.** It does not resolve from the public npm registry, so
  depending on it would make this example unbuildable for anyone without registry access.
  The markup here is plain on purpose; the subject is the SDK wiring, not the design system.
- **`src/main.tsx` renders the remote itself** with an `appState` assembled from env vars, so
  `pnpm dev` runs standalone. The federation build is still configured, so the same source is
  loadable by the real dashboard.
- **React 18.3, same as the template — and it has to be.** The host supplies React at runtime
  through federation's `shared`, so the module executes on the dashboard's copy. This example
  used to build against 19 on the theory that "both are acceptable, so nothing under `src/` may
  use a React-19-only API". That rule is not sufficient, and the example did not work in a real
  dashboard: React 18 and 19 produce **differently shaped elements** — 19 drops `ref` from the
  element and uses a different `$$typeof` — so the host's renderer does not recognise ours and
  throws React error #31, «Objects are not valid as a React child». It is a format break, not
  an API question, and no amount of discipline avoids it. Pin the major the host runs.
- **No `scripts/ensure-cors-origin.mjs`.** The template needs it because the dashboard origin
  lives both in `.env*` and hardcoded in `vite.config.ts`, so the two can drift. Here both the
  allowlist and the API host come from `src/environments.ts`, so there is nothing to guard —
  and the template's script is interactive, which makes it unusable in CI.
- **No committed per-mode `.env` files.** This repo's `.gitignore` ignores `.env` and `.env.*`
  with a single `!.env.example` exception, so the template's structure would need a hole in a
  rule that exists to keep credentials out. The hosts live in `src/environments.ts` instead;
  an env variable still overrides them.

## Environments

The dashboard runs in three environments and each has its own API host **and** its own
dashboard origin. `src/environments.ts` holds all three; `vite.config.ts` uses the origin for
the CORS allowlist and `src/emporix.ts` uses the API host at runtime, both from that one
module.

| Command | Mode | API host | Dashboard origin allowed |
| --- | --- | --- | --- |
| `pnpm dev` | `development` → dev | `api-develop.emporix.io` | `dev-admin.emporix.io` |
| `pnpm dev:stage` | `stage` | `api-stage.emporix.io` | `admin.emporix.io` |
| `pnpm build:dev` | `dev` | `api-develop.emporix.io` | `dev-admin.emporix.io` |
| `pnpm build:stage` | `stage` | `api-stage.emporix.io` | `admin.emporix.io` |
| `pnpm build` | `prod` | `api.emporix.io` | `admin.emporix.io` |

The dev dashboard is **`dev-admin`**, not `admin`. Getting that wrong does not produce an
error you can see: the browser refuses the cross-origin fetch of `remoteEntry.js`, so the
module never runs and cannot report anything.

The origin applies to `vite dev` and `vite preview` — which is how you load a
locally-running module into a real dashboard. A **deployed** remote gets its CORS headers from
wherever it is hosted, not from this config.

An unknown `--mode` throws at config load and fails the build, rather than quietly falling
back to a default and shipping a bundle aimed at the wrong dashboard.

## Running it

No env file is required — the environments above are committed. To point the module somewhere
else, or to give the standalone dev harness a real session, create an untracked `.env.local`
in this directory:

```
# Optional overrides of src/environments.ts
VITE_API_URL=https://api-develop.emporix.io
VITE_DASHBOARD_ORIGIN=https://dev-admin.emporix.io

# What the dashboard would pass as appState — used only by src/main.tsx
VITE_DEMO_TENANT=<your tenant>
VITE_DEMO_LANGUAGE=de
VITE_DEMO_TOKEN=<a customer token from a dashboard session>
```

Without `VITE_DEMO_TOKEN` the module renders a "Not configured" panel instead of crashing —
the same fallback a host gets if it mounts the remote without props.

The token is the one the dashboard would hand the module. Take it from a live dashboard
session. **It is a credential — keep it in `.env.local`, which is gitignored, and never
commit it.**

```bash
pnpm -F @viu/emporix-examples-md-module dev
```

## Building the remote

```bash
pnpm -F @viu/emporix-examples-md-module build         # prod
pnpm -F @viu/emporix-examples-md-module build:stage
pnpm -F @viu/emporix-examples-md-module build:dev
```

Each emits `dist/assets/remoteEntry.js` — Vite puts it under `assets/`, not at the `dist/`
root, which is the path the dashboard's remote entry must point at.

The environment is **not** baked in as a substituted host: `src/environments.ts` ships to the
browser and picks its entry from `import.meta.env.MODE`, which Vite replaces with a literal per
build. So a `build:dev` bundle carries `"dev"` at the call site and resolves to
`api-develop.emporix.io` at runtime.

## What to look at

| File | Why |
| --- | --- |
| [`src/RemoteComponent.tsx`](./src/RemoteComponent.tsx) | the whole integration: `customerSession="external"`, `initialCustomerToken`, `initialLanguage`, `onCustomerSessionExpired` |
| [`src/emporix.ts`](./src/emporix.ts) | one client per tenant, `credentials: {}`, host from the resolved environment |
| [`src/environments.ts`](./src/environments.ts) | the single source for API host and dashboard origin per mode |
| [`src/ProductList.tsx`](./src/ProductList.tsx) | `useProducts` with `totalCount: true` — the "X of Y" a dashboard table wants |
| [`vite.config.ts`](./vite.config.ts) | what is shared with the host (`react`, `react-dom`) and what deliberately is not |
| [`src/admin/useBrands.ts`](./src/admin/useBrands.ts) | wrapping a back-office operation the package ships no hook for, through the public `useEmporixQuery` |
| [`src/admin/ScopeError.tsx`](./src/admin/ScopeError.tsx) | rendering a 403 as the configuration answer it is, branching on `EmporixForbiddenError` |

## Administering brands and labels

`useProducts` in `ProductList` is a hook the package already ships. The Brands and
Labels views are the other case: **the Brand and Label services have no hook in
`@viu/emporix-sdk-react`**, because a storefront token cannot manage them. The
dashboard's token can, so the module wraps them itself — twelve lines each, through
the public `useEmporixQuery`.

Three things worth copying from `src/admin/useBrands.ts`:

- **`mode: "customer"`, even though brand *reads* also accept an anonymous token.**
  This module builds its client with `credentials: {}`, so there is nothing to mint
  an anonymous token *with* — `mode: "read-auth"` would attempt a login that cannot
  succeed. In a host-token module, reads are `customer` even where the endpoint
  would allow otherwise.
- **`site: "none"`.** Brands and labels are tenant-scoped. Keying by site would
  fragment the cache and bill once per site for one answer.
- **The `ctx` the factory hands you must be passed on.** Both facades default their
  `auth` parameter to a *service* context — client credentials with a secret, which
  a browser does not have.

The endpoints carry **no `{tenant}` segment**: `/brand/brands`, `/label/labels`.
The tenant comes from the token. This is easy to get wrong from the method names
alone, and it is what the SDK's own comment says.

## Verified against the live tenant

Run on 2026-08-27 against `viu` with a dashboard token, standalone (`pnpm dev`),
with the token in an untracked `.env.local`.

| | Result |
| --- | --- |
| Products read | 20 of **928** real products |
| Brands read | `GET /brand/brands?pageSize=50` → 200, empty list |
| Labels read | `GET /label/labels` → 200, empty list |
| Is the token doing the work? | the same URL without a bearer answers **401** |
| Brand create | `POST /brand/brands` → a real id |
| Does the table refresh itself? | **yes** — the mutation's invalidation triggered the refetch, no reload |
| Brand delete | removed; the tenant is back to the state it was found in |

**Not exercised: the 403 path.** `ScopeError` is covered by a unit test, but
producing a real 403 needs a token that lacks the scope, and the dashboard token
has it. Verifying it live would mean minting a storefront token for this tenant —
worth doing before anyone relies on that message, and not something to fabricate.

**Both tenants' brand and label lists are empty**, so the table, the empty state
and one create/delete cycle are proven, while pagination and editing an existing
row are not. A tenant with real brands would exercise the rest.
