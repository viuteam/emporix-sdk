# @viu/emporix-sdk-next

Next.js server-side bindings for [`@viu/emporix-sdk`](../sdk): cache tags,
cookie session, and webhook-driven revalidation. Server-only — every export
reaches for `next/headers` or `next/cache`.

> **Why the package is shaped this way** — the session flow diagrams, the login
> ordering trap, the dynamic-rendering cost of one `cookies()` call, and the
> post-mortems behind several of these APIs live in
> [`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md).
> This README is the reference; that page is the reasoning.

## Install

```bash
pnpm add @viu/emporix-sdk-next @viu/emporix-sdk next
```

`@viu/emporix-sdk` and `next` are peer dependencies. This package itself has no
runtime dependencies.

`@viu/emporix-sdk-react` is **not** required. It used to be — the session keys and
the cookie-backed storage lived there — but none of that was React, so it moved to
`@viu/emporix-sdk`. A server-first app now installs no React, no
`@tanstack/react-query`, and no client bundle at all. Add the React package only
if you also want a SPA.

Requires **Next 16**. Next 15 is not supported: Next 16 made `revalidateTag`'s
second `cacheLife` argument mandatory, and bridging both signatures would need a
runtime shim for no benefit.

## The one rule

**A customer token never goes through the tagged client.**

```ts
getEmporixClient()                    // tagged + cacheable — anonymous catalog reads
getEmporixClient({ tagged: false })   // untagged — anything with a customer token
```

Next's fetch cache does not key on the `Authorization` header, so a
customer-scoped response cached by the tagged client would be served to other
visitors. The package cannot detect this for you: `AuthContext` is per call, and
anonymous and customer tokens both arrive as `Bearer <jwt>`. The boundary is
explicit because making it implicit is what would introduce the leak.

## Entries

| Import | Contains |
|---|---|
| `@viu/emporix-sdk-next` | `getEmporixClient`, `createTaggingFetch`, `emporixTags`, `emporixTagsForUrl`, `emporixSession`, `emporixSessionMutable` |
| `…/session` | server-first mode — `withEmporixSession(Mutable)`, `emporixLogin/Logout/Refresh`, `emporixTokenProxy`, `emporixSessionHandle`, `createEmporixPublicRoute`, `assertSameOrigin`, `STORAGE_KEYS`, `SESSION_*` |
| `…/proxy` | `emporixSiteProxy` |
| `…/service` | `getEmporixServiceClient` |
| `…/webhook` | `createEmporixWebhookRoute`, `canonicalJson` |
| `…/public-client` | `createProxyFetch`, `createProxyTokenProvider` — the only entry shipping `"use client"` |

The split keeps a Route Handler from pulling in `next/headers` — and a `proxy.ts`
cannot pull it in at all, because `cookies()` does not exist in a proxy context.
`./service` and `./session` carry secrets, and their export conditions make a
client-side import a **build error**, not a lint warning.

## Server-first mode: no token in the browser

Every Emporix call needs a bearer token where the call originates. So "no token
in the browser" means one thing only: **the browser makes no Emporix calls.**
Server Components read, Server Actions write, and a narrow proxy serves the
public catalog. See [`../../examples/next-server-first`](../../examples/next-server-first)
for a running demo, and [`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md)
for how the session moves through a request.

### One helper covers every customer and cart call

```ts
// app/actions/cart.ts
"use server";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/session";

export async function addToCart(cartId: string, item: CartItemRequest) {
  return withEmporixSessionMutable((client, ctx) =>
    client.carts.addItem(cartId, item, ctx),
  );
}
```

Use `withEmporixSession` in Server Components and `withEmporixSessionMutable` in
Server Actions and Route Handlers. The read-only variant no-ops cookie writes,
because Next forbids writing during a render.

The helper branches on the session so you do not have to: a customer token gives
you the memoized untagged client plus `auth.customer`; no token gives you a
**per-request** client with a per-guest anonymous session plus `auth.anonymous`.
That branch is not cosmetic — Emporix maps the anonymous token's `session-id` onto
the cart when the cart is created, so two guests sharing a client would share a
cart. Neither path can be tagged: `withEmporixSession*` never passes a `fetch`.

> **Two things worth reading before you build on this:** one `cookies()` call in a
> layout makes every route dynamic, and a cart id in the session can be dead after
> the customer orders on another device. Both are covered in
> [`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md).

### Login, logout, refresh

```ts
// app/actions/auth.ts
"use server";
import { emporixLogin, emporixLogout } from "@viu/emporix-sdk-next/session";

export async function login(formData: FormData) {
  await emporixLogin({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
}
export async function logout() {
  await emporixLogout();
}
```

`emporixLogin` returns `void` on purpose: there is no token for a Server Action
to serialize into a response body.

`emporixRefresh(opts?)` rotates the customer session from the httpOnly refresh
cookie and returns the fresh access token, or `null` when there is nothing to
refresh. `emporixTokenProxy` calls it for you — reach for it directly only if you
rotate somewhere other than the proxy. Like the other readers it takes `store`.

### Token rotation belongs in the proxy

```ts
// proxy.ts
import type { NextRequest } from "next/server";
import { emporixTokenProxy } from "@viu/emporix-sdk-next/session";

export async function proxy(request: NextRequest) {
  return emporixTokenProxy(request, { site: { siteCode: "main" } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
```

A Server Component cannot write a cookie, so it cannot rotate a token — and an
unpersisted rotation is worthless. The proxy can do both and runs before every
render. It delegates site and language to `emporixSiteProxy`, so one proxy
function is enough.

### Client-side catalog reads, still without a token

```ts
// app/api/emporix/[...path]/route.ts
import { createEmporixPublicRoute } from "@viu/emporix-sdk-next/session";
export const GET = createEmporixPublicRoute();
```

```ts
import {
  createProxyFetch,
  createProxyTokenProvider,
} from "@viu/emporix-sdk-next/public-client";

const client = new EmporixClient({
  tenant,
  credentials: { storefront: { clientId: "proxied" } },
  tokenProvider: createProxyTokenProvider(),
  fetch: createProxyFetch({ base: "/api/emporix" }),
});
```

`createProxyTokenProvider` makes **no network call**. That is what keeps the
browser token-free: the SDK's default provider fetches an anonymous token over
the global `fetch`, which a rewriting `fetch` cannot intercept, so the answer is
not to request one.

The route's allowlist is `emporixTagsForUrl` — a URL is proxyable exactly when it
yields cache tags. Cart, order, customer and token endpoints yield none and get a
403. Proxying catalog reads is a net win: Next caches each response once for all
visitors instead of every browser fetching it.

### CSRF

`assertSameOrigin(request)` is exported for your own Route Handlers. It rejects
`Sec-Fetch-Site: cross-site`, and rejects a request carrying neither
`Sec-Fetch-Site` nor `Origin` — accepting those would make omitting the header
the bypass. Server Actions already get Next's own origin check; plain Route
Handlers do not.

## Session cookie hardening

| Control | Default | Configure with |
|---|---|---|
| Idle window (sliding) | 30 days | `SESSION_MAX_AGE.refreshToken` |
| Absolute ceiling | 90 days | `SESSION_ABSOLUTE_MAX` |
| `__Host-` prefix | on over https | derived from the same signal as `secure` |
| Encryption | off | `EMPORIX_COOKIE_SECRET` |

The idle window slides — every refresh rewrites the cookie — so on its own it
never expires an active session. The ceiling is stamped at login and never
rewritten, which is what actually bounds a session. Reaching it clears the
session and forces a fresh login.

Generate a key:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Rotate by prepending the new key and keeping the old one for one refresh cycle:

```
EMPORIX_COOKIE_SECRET="<new>,<old>"
```

Turning encryption on invalidates every running session, and what it does and does
not protect is worth knowing before you rely on it —
[`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md#what-cookie-encryption-does-and-does-not-prevent).

### Read the session through `emporixSessionHandle`, never `cookies()`

```ts
const handle = await emporixSessionHandle({ readOnly: true }); // omit in a Server Action
const cartId = handle.get(STORAGE_KEYS.cartId);
```

A raw `cookies()` read hands back the ciphertext once `EMPORIX_COOKIE_SECRET` is
set, and works fine until then — so the mistake survives review. Use
`{ readOnly: true }` in Server Components, where writes no-op because Next forbids
a cookie write during render.

> **Deprecated aliases.** `sessionCookieJar` and `SessionCookieJar` were renamed to
> `emporixSessionHandle` / `EmporixSessionHandle` in 0.5.0. Both old names are
> still exported as of 0.8.x and are still the same function; they are
> `@deprecated` and will be removed in **1.0.0**. A one-line find-and-replace is
> the whole migration.

## Server-side sessions

Pass a `store` and the session values leave the browser entirely. What is left in
the browser is one opaque id.

```ts
import type { EmporixSessionStore } from "@viu/emporix-sdk-next/session";

const store: EmporixSessionStore = {
  read: async (id) => /* the record, or null */,
  write: async (id, record, ttlSeconds) => /* replace it */,
  destroy: async (id) => /* remove it */,
};
```

Three methods. The package ships **no** implementation, which is what keeps it at
zero runtime dependencies — copy the Redis one from
`examples/next-server-first/app/session-store.ts`.

Pass it to all three readers:

```ts
const EMPORIX = { context: CONTEXT, store };

await withEmporixSession(fn, EMPORIX);              // pages
await emporixTokenProxy(request, { site, store });  // proxy.ts
await emporixSession({ store });                    // session values
```

Forget it in one place and that place silently falls back to cookie mode. There
is no error, because cookie mode is a legitimate configuration.

### What stays in the cookie

| Cookie | Store mode |
|---|---|
| `emporix.sid` | 32 random bytes, httpOnly, `__Host-` |
| `emporix.siteCode`, `emporix.language` | still cookies — browser-readable on purpose |
| everything else | in the store |

Store-mode TTLs, what revocation can and cannot do, and why
`EMPORIX_COOKIE_SECRET` is not applied here:
[`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md#store-mode).

## Service accounts (`@viu/emporix-sdk-next/service`)

For server-side writes with a dedicated Emporix service account — create a
product, set a price — with `clientId`, `secret` and only the scopes that account
was granted.

```ts
// lib/emporix-service.ts — module scope, NOT inside a handler body
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
```

```ts
// app/api/products/route.ts
import { auth } from "@viu/emporix-sdk";
import { service } from "@/lib/emporix-service";

export async function POST(request: Request) {
  const created = await service.products.create(
    await request.json(),
    {},
    auth.service("productWriter"),
  );
  return Response.json(created);
}
```

The key in `credentials` is the name you pass to `auth.service(name)`. Works from
Route Handlers, Server Actions and Server Components.

**Module scope is load-bearing** — the SDK's token cache lives on the client
instance, so calling the factory inside a handler body fetches a token per
request. There is deliberately no `tagged` and no `context` option, and SSE
streaming needs its own Route Handler:
[`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md#service-account-details).

## Server Component

```tsx
import { getEmporixClient, emporixSession } from "@viu/emporix-sdk-next";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { auth } = await emporixSession();
  const sdk = getEmporixClient();                       // memoized per process
  const product = await sdk.products.get(id, undefined, auth);
  return <h1>{product.name}</h1>;
}
```

Catalog GETs are tagged automatically — `emporix:product:{id}` and
`emporix:products` here. Cart, order, customer and token requests map to no tags
and are therefore never cached.

## Server Action

```ts
"use server";
import { emporixSessionMutable, getEmporixClient } from "@viu/emporix-sdk-next";

export async function login(formData: FormData) {
  const { storage } = await emporixSessionMutable();     // httpOnly, secure, lax
  const sdk = getEmporixClient({ tagged: false });
  const session = await sdk.customers.login({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  storage.setCustomerToken(session.customerToken);
}
```

`emporixSession()` is read-only, because Next forbids cookie writes during a
render; a write attempt warns once per key instead of throwing.

## Webhook revalidation

```ts
// app/api/emporix/webhook/route.ts
import { createEmporixWebhookRoute } from "@viu/emporix-sdk-next/webhook";

export const POST = createEmporixWebhookRoute({
  secret: process.env.EMPORIX_WEBHOOK_SECRET!,
  maxAgeSeconds: 300,
});
```

Verifies `emporix-event-signature`, checks `emporix-event-publish-time` against
the window, then calls `revalidateTag` for each affected tag. 401 on failure,
revalidating nothing. A throwing `onEvent` returns 500 so Emporix retries.

`revalidateTag`'s second argument defaults to `{ expire: 0 }` — immediate expiry,
which the Next docs prescribe for webhooks and third-party services calling your
Route Handlers. Pass `profile: "max"` for stale-while-revalidate instead, which
keeps serving the old response until a page using the tag is next visited. For a
price change or a product going out of stock, immediate expiry is usually what you
want.

**The signature is computed over a canonically re-serialized body, not the raw
bytes** — a verifier written against raw bytes rejects every real delivery, and the
vendor's own docs are not self-consistent on this. Smoke-test one real delivery
before production:
[`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md#the-webhook-signature).

## Cache tags

| Read | Tags |
| --- | --- |
| one product | `emporix:product:{id}`, `emporix:products` |
| product listing / search | `emporix:products` |
| one category (+ subcategories, parents) | `emporix:category:{id}`, `emporix:categories` |
| category tree | `emporix:category-tree:{id}`, `emporix:categories` |
| prices | `emporix:prices` |
| availability | `emporix:availability` |
| sites | `emporix:sites` |

Construct them yourself with `emporixTags`, or map a URL with
`emporixTagsForUrl(url, tenant)`.

Tags are derived from the request URL rather than passed per call, because the
SDK has 596 request call sites and a per-call tag would be forgotten at one of
them. The mapper keeps a reserved-segment set (`bulk`, `search`, `recalculate`,
`jobs`) so real paths like `/products/bulk` yield the collection tag instead of
a tag for a product called "bulk".

## Environment

`EMPORIX_TENANT`, `EMPORIX_STOREFRONT_CLIENT_ID`, optionally `EMPORIX_HOST` — or
pass `tenant` / `clientId` / `host` explicitly.

A Next app usually has to pass them explicitly: any value its Client Components
also read needs the `NEXT_PUBLIC_` prefix, and these server-only names do not
carry it. See [`examples/next-app-router/app/emporix.ts`](../../examples/next-app-router/app/emporix.ts)
for the one-file mapping.

```ts
getEmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT,
  clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID,
  context: { siteCode: "main", currency: "CHF" },
});
```

`context` is bound at anonymous login. It is needed for `prices.matchByContext`,
and for prefetch-key parity with the client-side `EmporixProvider` — bind the same
values on both sides or hydration is a cache miss instead of a hit.

`getEmporixClient` configures **storefront** (anonymous) credentials only. There
is no option for a `backend` / service credential set, because a secret does not
belong in a memoized factory where it becomes part of a cache key. Server-side
work needing a `service` AuthContext — `media.*`, for instance — constructs its
own client:

```ts
import { EmporixClient } from "@viu/emporix-sdk";
import { createTaggingFetch } from "@viu/emporix-sdk-next";

const sdk = new EmporixClient({
  tenant,
  credentials: { backend: { clientId, secret } },
  fetch: createTaggingFetch({ tenant, revalidate: 3600 }),
});
```

Both entry points also take a request budget —
`{ timeouts: { connectMs, readMs } }`. The SDK's defaults (10 s / 60 s) are a poor
fit for a storefront under load; see
[`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md#picking-a-request-budget).

## Site and locale detection (`proxy.ts`)

`siteCode` and `language` go into two places that have to agree: the server's
`getEmporixClient({ context })` and `prefetchEmporix` keys, and the client's
`SiteContextProvider`. Disagree and every hydration cache hit becomes a miss.
A `proxy.ts` is the only place to resolve them before the render.

`emporixSiteProxy` owns the cookie mechanics. You own the routing policy:

```ts
// proxy.ts (project root, or src/proxy.ts)
import type { NextRequest } from "next/server";
import { emporixSiteProxy } from "@viu/emporix-sdk-next/proxy";

const LANGUAGES = new Set(["de", "fr", "en"]);

export function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split("/")[1] ?? "";
  return emporixSiteProxy(request, {
    siteCode: "main",
    ...(LANGUAGES.has(segment) ? { language: segment } : {}),
  });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
```

Pass a third argument to rewrite instead of passing through —
`emporixSiteProxy(request, site, "/shoes")` resolves a relative target against
the request URL. Redirects do not need the function: there is no render to
inject headers into, and the `Set-Cookie` travels with the redirect.

Three things will bite you here — the `matcher` cannot be an imported constant,
the browser half needs `createCookieStorage`, and a resolved value overwrites the
cookie. Cookies are also only persisted on a real navigation, not on a prefetch,
which took a production repro to pin down:
[`docs/next.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/next.md#only-a-real-navigation-persists-the-site-cookies).

Next 16 pinned `proxy` to the Node runtime — `export const runtime = "edge"`
throws.

## `next/image`

Emporix media has no documented transform parameters; PUBLIC assets resolve to a
storage URL. There is no custom loader to install — add the storage host to
`images.remotePatterns` in `next.config.mjs` and use `next/image` normally.

An `httpOnly` customer-token cookie cannot be read by the browser-side
`createCookieStorage`, so `<EmporixProvider>` mounts unauthenticated. Read the
cookie on the server and pass `initialCustomerToken` into the provider — see
[`../../docs/react.md`](../../docs/react.md).

## Changelog

npmjs.com renders only this README, never a changelog — the registry has no field
for one. The per-version history lives here instead:

- [`CHANGELOG.md`](https://github.com/viuteam/emporix-sdk/blob/main/packages/next/CHANGELOG.md)
  — the whole history in one file. Also shipped inside the published tarball, so
  [unpkg serves it](https://unpkg.com/@viu/emporix-sdk-next/CHANGELOG.md) straight
  from the release artifact.
- [Releases](https://github.com/viuteam/emporix-sdk/releases) — one entry per
  published version, each linking the PR and the commit behind every change.

## Authors

- **Dominic Fritschi** — _Maintainer_ — [VIU](https://www.viu.ch)
- The **Team at VIU** — _Contributors_ — [VIU](https://www.viu.ch)

## License

MIT — see [LICENSE](./LICENSE).
