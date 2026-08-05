# Service Account in the next Package — Design

**Status:** approved
**Date:** 2026-07-31
**Package:** `@viu/emporix-sdk-next`
**Related:** `2026-07-31-emporix-sdk-next-design.md` (the `tagged` rule),
`2026-07-31-next-proxy-site-detection-design.md` (the entry separation)

## Problem

A storefront needs server-side write access with a service account of its own —
create a product, set a price, retro-fill an order — with a `clientId` and a
`secret` and only the scopes granted for it.

The SDK can do all of that: `credentials.custom` takes any number of named
`ServiceCredentials`, `auth.service("name")` picks one of them, and token
caching is built in. The next package **cannot**: `getEmporixClient` only ever
builds `credentials.storefront` and knows neither `secret` nor `custom`.

Anyone building it themselves today carries two things that can be silently
wrong:

1. **The token cache is tied to the client instance.** A `new EmporixClient(...)`
   in the body of a route handler is rebuilt on every request, fetches one token
   per request and renders the caching useless.
2. **A service client must never be given `createTaggingFetch`.** Next's fetch
   cache does not key on `Authorization`; a cached response to a privileged GET
   ends up with other visitors.

And a third risk, the one that triggered this spec: **the secret must not end up
in the frontend bundle.** `getEmporixClient` lives in the root entry. Pass a
`secret` through there and it sits in a module that a client component can
import by accident — and Next writes it into the browser bundle at build time.
No error, no warning, just a published secret.

## Measured groundwork

All of it measured against `next@16.2.12` and the SDK in this repo.

### The SDK side

| Fact | Source |
|---|---|
| `credentials.custom?: Record<string, ServiceCredentials>` exists | `packages/sdk/src/core/config.ts` |
| `ServiceCredentials = { clientId, secret, scope? }` | ditto |
| `auth.service(name?)` picks the set, default `"backend"` | [auth.ts:95](../../../packages/sdk/src/core/auth.ts#L95), [auth.ts:109](../../../packages/sdk/src/core/auth.ts#L109) |
| `scope` goes into the `client_credentials` body as the `scope` field | [auth.ts:270](../../../packages/sdk/src/core/auth.ts#L270) |
| Token cache per set, expiry `expires_in − expirationBufferSeconds` | [auth.ts:282-286](../../../packages/sdk/src/core/auth.ts#L282) |
| Buffer default 60 s, hard upper limit `maxLifetimeSeconds` 3600 s | `config.ts`, [auth.ts:226](../../../packages/sdk/src/core/auth.ts#L226) |
| Single-flight lock per set — N parallel calls fetch **one** token | [auth.ts:235-239](../../../packages/sdk/src/core/auth.ts#L235) |
| An unknown set throws `Unknown credential set "x"` before the cache path | [auth.ts:219](../../../packages/sdk/src/core/auth.ts#L219), [auth.ts:231](../../../packages/sdk/src/core/auth.ts#L231) |
| Token requests deliberately use the global `fetch`, not the injected one | `config.ts`, comment on `EmporixConfig.fetch` |
| `client.config` is public (`readonly config: ResolvedConfig`) | `packages/sdk/src/client.ts:117` |
| `context` is attached to `StorefrontCredentials`, **not** to `ServiceCredentials` | `config.ts` |
| Admin writes have `auth: AuthContext = SERVICE` as their default | `packages/sdk/src/services/product.ts:295-299` |

### The bundler boundary

The mechanism comes from `client-only@0.0.1`, read out of the pnpm store:

```json
"exports": { ".": { "react-server": "./error.js", "default": "./index.js" } }
```

`index.js` is empty, `error.js` throws. `server-only` is the mirror image of it.
`server-only` is **not** in the store, and `packages/next` has no
`dependencies` section at all.

Whether the `react-server` condition is set in the relevant contexts was the
load-bearing unknown. Next's webpack config applies `reactServerConditionNames`
to only three layers — RSC, `middleware`, `instrument` — and **not** to
`apiNode`, so not to route handlers. From that one could conclude that the guard
would break in exactly the place where you create a product.

That is wrong. Measured with a spike (a temporary `exports` condition on
`packages/next`, two files in `dist/`, everything deleted afterwards) against a
real `next build` with Turbopack, the default in Next 16:

| Context | Resolution | Result |
|---|---|---|
| Route handler (`app/*/route.ts`) | `react-server` | The import succeeds, the route returns the marker |
| Server action (`"use server"`, imported from a client component) | `react-server` | The build compiles, so it resolved to the valid file |
| Client component (`"use client"`) | `default` | **The build fails** with two errors, layers `[app-client]` and `[app-ssr]` |

The client case therefore fails at **build time**, not only at runtime in the
browser. That is stronger than a runtime check: the secret cannot be written
into a bundle in the first place.

The webpack config was the wrong source — Next 16 uses Turbopack, and its
resolution does not follow the layer split of the webpack config.

## Decision: a dedicated entry with an `exports` guard

A new entry `@viu/emporix-sdk-next/service` whose resolution points at a
throwing file outside the server graph.

```json
"./service": {
  "react-server": {
    "types": "./dist/service.d.ts",
    "import": "./dist/service.js",
    "require": "./dist/service.cjs"
  },
  "default": "./service-is-server-only.js"
}
```

`service-is-server-only.js` lives in the package root, not in `dist/`. The
reason is not a suspicion about tree shaking but `clean: true` in
`packages/next/tsup.config.ts`: a hand-placed file in `dist/` would be gone
after the next build. It therefore needs an entry of its own in the `files`
array.

```js
// service-is-server-only.js
throw new Error(
  "@viu/emporix-sdk-next/service is server-only: it carries a client secret. " +
    "It was resolved outside the server graph — most likely imported from a " +
    '"use client" module. Move the import into a Route Handler, a Server ' +
    "Action, or a Server Component.",
);
```

Two belts, on purpose:

- The bundler does not find the named export and **fails the build**. That is
  the path measured above, and the file name appears in the message.
- Should a bundler ever include the file anyway, it throws on load with a text
  of its own.

**No new dependency.** `server-only` would be 1 KB for four lines and would give
up the zero-dependency property of `packages/next`. The mechanism is fully
expressible in the `exports` map.

## Surface

```ts
export interface EmporixServiceCredentials {
  clientId: string;
  secret: string;
  /** Space-separated OAuth scopes. Omit to get whatever the account has. */
  scope?: string;
}

export function getEmporixServiceClient(opts: {
  /** Named credential sets. The name is what `auth.service(name)` takes. */
  credentials: Record<string, EmporixServiceCredentials>;
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
}): EmporixClient;
```

The return value is an ordinary `EmporixClient` — every service is reachable, no
wrapper per operation. What the account may do is bounded by its scopes on the
server side; an allowlist in the package would be a second, weaker copy of the
same rule and would need a package version for every new operation.

```ts
// lib/emporix-service.ts — module scope, not inside a handler body
import { getEmporixServiceClient } from "@viu/emporix-sdk-next/service";

export const service = getEmporixServiceClient({
  credentials: {
    productWriter: {
      clientId: process.env.EMPORIX_PRODUCT_WRITER_ID!,
      secret: process.env.EMPORIX_PRODUCT_WRITER_SECRET!,
      scope: "product.product_create",
    },
  },
});

// app/api/products/route.ts
import { auth } from "@viu/emporix-sdk";
import { service } from "@/lib/emporix-service";

export async function POST(request: Request): Promise<Response> {
  const created = await service.products.create(
    await request.json(),
    {},
    auth.service("productWriter"),
  );
  return Response.json(created);
}
```

### Three decisions in the signature

**No `tagged` parameter.** Untagged is structural, not configurable:
`getEmporixServiceClient` never sets `fetch`. `client.config.fetch` stays
`undefined` and is therefore directly testable. An option that can be set to
`true` would be an option that someone sets to `true` eventually.

**No `context` parameter.** `context` is attached to `StorefrontCredentials` and
is bound during the anonymous login. A service client has no storefront
credentials, so there is no place for it. The option would have no effect and
would suggest that it did something.

**Memoisation on `JSON.stringify(opts)`**, secrets included. That is not a new
risk: the client holds them in `ResolvedConfig.credentials` in the process
anyway. A key without the secrets could silently return the client with the
wrong secret when two sets share a name — a hash in between would be ceremony
for a risk that does not exist.

The memoisation is the reason the function exists at all. It is what makes the
SDK's token cache take effect: one instance per process, not one per request.

## Non-goals

- **No wrapper per operation.** The account's scopes are the boundary.
- **No env-var convention for the credentials.** `tenant` and `host` may default
  from `process.env` the way they do in `getEmporixClient`, but what the secrets
  are called is the storefront's decision. An enforced naming convention would
  be policy inside a published package.
- **No `next/headers`, no cookies.** A service account has no session.
- **No change to `getEmporixClient`.** The root entry stays free of secrets —
  that is half the security property.
- **No `server-only` dependency.**
- **No change to the example.** A service account in the reference storefront
  would need real credentials in `.env.local` and a second client with write
  permissions. Verification happens with temporary, uncommitted files.

## Tests

In `packages/next/tests/service.test.ts`, sixteen tests in four groups.

**Instance and configuration**

| # | Case | Expectation |
|---|---|---|
| 1 | twice with identical options | the same instance |
| 2 | twice with different options | different instances |
| 3 | `client.config.fetch` | `undefined` — no tagging fetch |
| 4 | `credentials.custom` passed through | `client.config.credentials.custom.productWriter.clientId` is right |
| 5 | `host` override | ends up in the token URL, not just in the config |

**Token behaviour** — all of them through a stubbed `globalThis.fetch`. Token
requests deliberately use the global `fetch` and not the injected one, so that
is the right point of attack.

| # | Case | Expectation |
|---|---|---|
| 6 | `scope` passed through | appears in the `client_credentials` body |
| 7 | caching, sequential | two calls → **one** token request |
| 8 | caching, parallel | ten simultaneous calls → **one** token request (single-flight lock) |
| 9 | expiry | `expires_in: 1` and buffer 60 → the second call fetches anew |
| 10 | two different sets | two token requests, each with the right `client_id` |
| 11 | unknown set | throws `Unknown credential set "nope"` |

**Validation** — new compared with the first draft, requires code

| # | Case | Expectation |
|---|---|---|
| 12 | missing tenant | throws, the message names `EMPORIX_TENANT` |
| 13 | `credentials: {}` | throws, the message says that at least one set is required |
| 14 | set with an empty `clientId` or `secret` | throws and names the set |

Test 14 is the most valuable of the three. An env variable that is not set
currently yields an empty string, which goes to Emporix as the `client_secret`
and comes back from there as a 401 — an error that looks like a permissions
problem and is not one. The check belongs in `getEmporixServiceClient`, because
there it runs once per process instead of once per request.

**The boundary, as far as it is checkable without a bundler**

| # | Case | Expectation |
|---|---|---|
| 15 | importing the guard file | rejects, the message names `use client` and the entry name |
| 16 | `exports` map and `files` | `./service` has `react-server` and `default`, `default` points at the guard file, and that file is listed in `files` |

Test 15 really does check the second belt — that the file throws on load, and
with a message that shows the way out. Test 16 catches the case that only
surfaces on publishing: if the `files` entry is missing, the guard file is not
in the tarball and the `default` condition points at nothing.

### What no test covers

**A unit test cannot exercise the bundler condition itself.** Test 16 checks the
shape of the map, test 15 the behaviour of the file — but whether Turbopack
actually resolves to `default` inside a `"use client"` module is shown only by a
build.

### What no test covers

**A unit test cannot exercise a bundler condition.** The guard is backed by the spike measured today, not by the suite. The
plan repeats that measurement against the built package — temporary files in the
example, one `next build`, deleted afterwards:

1. Import from a route handler → the build succeeds, the route responds.
2. Import from a `"use client"` file → the build **fails** with
   `[app-client]` and `[app-ssr]`.

Step 2 is the actual proof. Without it the security property is asserted, not
shown.

## Docs

One section in `packages/next/README.md` directly after «The one rule», because
it is the same rule one notch sharper: the module-scope pattern, the use of
`auth.service(name)`, the built-in cache numbers, and what happens when you
import the entry from a client component.

The section states explicitly that `tagged` does not exist, and why.

## Security boundary during execution

The tenant's credentials live exclusively in the untracked
`examples/next-app-router/.env.local` (`.gitignore:7`). The verification needs
**no** real service-account credentials: the guard test checks resolution and
build, not a successful Emporix call. A placeholder is enough, and no credential
value is ever written into a terminal, a commit, the docs or the plan.

## Open follow-ups afterwards

1. `docs/nextjs.md` with the `images.remotePatterns` entry for `next/image` —
   still open, pure documentation.
2. Whether `getEmporixClient` should get a guard of its own. Today it lives in
   the root entry and is correctly there: it carries no secret, only a
   storefront `clientId`, which is allowed to appear in the browser too. Only
   when someone wants to pass `backend` credentials through does that become a
   question — and the answer would be to send them to `./service` instead.
