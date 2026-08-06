# Server-First Mode in the next Package — Design

**Status:** approved
**Date:** 2026-07-31
**Package:** `@viu/emporix-sdk-next`
**Occasion:** Finding F-01 from the session security review (refresh token in
JS-readable cookies), aggravated by F-13 (tokens as URL query parameters)
**Related:** `2026-07-31-next-service-account-design.md` (the `exports` guard),
`2026-07-31-next-proxy-site-detection-design.md` (the proxy entry)

## Goal

A Next storefront must hold **no Emporix token in the browser** — not even an
anonymous one. The react package remains unchanged as the SPA path; anyone who
only wants a SPA keeps using it with today's security profile.

## The hard constraint

Every Emporix call needs a bearer token where the call originates
([http.ts:86](../../../packages/sdk/src/core/http.ts#L86)). From that it follows
inevitably:

> «No token in the browser» is equivalent to «the browser makes no Emporix
> calls».

There is no third option. The mode therefore consists of moving every call to
the server side — not of hiding tokens better.

Two approaches were rejected:

**Catch-all proxy with a sentinel token.** The browser keeps the react hooks, a
rewriting `fetch` routes everything to a route of our own. Fails because token
acquisition **bypasses** the injected `fetch`
([auth.ts:252](../../../packages/sdk/src/core/auth.ts#L252) uses the global
`fetch`) — so an anonymous token ends up in the browser after all. On top of
that, SSE bypasses it too
([http.ts:321](../../../packages/sdk/src/core/http.ts#L321)) and breaks.

**Change the SDK so that token requests use the injected `fetch`.** Would
complete the sentinel path, but it inverts the documented property that token
responses *cannot* be cacheable (comment on `EmporixConfig.fetch`). Trading a
proven property for a new one, and in the end all the drawbacks of the proxy
remain.

## Measured foundations

Everything measured in the repo. **No SDK change needed** — every hook-in point
required is already public.

| Fact | Source |
|---|---|
| `client.tokenProvider` is public, explicitly «Exposed so React/Next hosts can call `attachAnonymousStore`» | [client.ts:105-110](../../../packages/sdk/src/client.ts#L105) |
| `attachAnonymousStore(store)` bootstraps with `expiresAt = 0` → the next call performs a **refresh with the preserved sessionId**, not a new login | [auth.ts:189-196](../../../packages/sdk/src/core/auth.ts#L189) |
| `AnonymousSessionStore` is `{ read(), write() }`, **synchronous** | [auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42) |
| `EmporixConfig.tokenProvider` is a public option, `create-core.ts` uses it instead of the default | [config.ts:46](../../../packages/sdk/src/core/config.ts#L46), [create-core.ts:61](../../../packages/sdk/src/core/create-core.ts#L61) |
| `EmporixConfig.fetch` replaces the request `fetch` in two places | [http.ts:149](../../../packages/sdk/src/core/http.ts#L149), [:285](../../../packages/sdk/src/core/http.ts#L285) |
| `emporixTagsForUrl` returns `[]` for «a different tenant, a non-catalog service, a personalized resource» | [tags.ts:36-42](../../../packages/next/src/tags.ts#L36) |
| Exactly five services get tagged: `product`, `category`, `price`, `availability`, `site` | [tags.ts:55,62,77,79,81](../../../packages/next/src/tags.ts#L55) |
| The session store mirrors external `setCustomerToken` writes into the React tree | [customer-session-store.ts:70-72](../../../packages/react/src/hooks/internal/customer-session-store.ts#L70) |
| A server component render cannot write cookies | Next docs, and `emporixSession()` is read-only for that reason |
| The proxy **can** write cookies and runs before every render | verified today, `2026-07-31-next-proxy-site-detection-design.md` |
| Cart, order and customer endpoints are never tagged | [tags.ts:41](../../../packages/next/src/tags.ts#L41) |

### Confirmed by the tenant

**Emporix binds the guest cart to the anonymous session.** When a cart is
created, the `session-id` of the anonymous token is mapped onto the cart
(confirmed for the `viu` tenant).

This is the most important constraint of the entire design. It rules out the
obvious simplification that the server's process-wide memoized anonymous token
could serve every guest and that `cartId` in the cookie would suffice. Every
guest needs its **own** anonymous session, managed server-side.

## The four building blocks

### 1. Auth server functions

A new entry `@viu/emporix-sdk-next/bff`, with the same `exports` guard as
`./service`: it processes refresh tokens, so a client import must break the
build. `types` sits outside the conditions — TypeScript does not understand
`react-server` (measured in the service cycle).

```ts
export async function emporixLogin(creds: { email: string; password: string }): Promise<void>;
export async function emporixLogout(): Promise<void>;
export async function emporixRefresh(): Promise<string | null>;
export function assertSameOrigin(request: Request): void;
```

The consumer wraps them in its **own** `"use server"` file:

```ts
// app/actions/auth.ts — the consumer's file carries "use server"
"use server";
import { emporixLogin, emporixLogout } from "@viu/emporix-sdk-next/bff";

export async function login(formData: FormData): Promise<void> {
  await emporixLogin({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
}
export async function logout(): Promise<void> {
  await emporixLogout();
}
```

Three lines of boilerplate per storefront — in exchange the package needs
**no** `"use server"` banner and no second tsup config. Exporting server actions
from a factory is fragile in Next; the wrapper variant is robust.

`emporixLogin` threads the guest's anonymous token through so that the cart
survives the login (`customers.login` expects that,
[customer.ts:122-133](../../../packages/sdk/src/services/customer.ts#L122)). It
comes from the httpOnly cookie, not from the client.

### 2. Token rotation exclusively in the proxy

A server component cannot write cookies. A refresh during the render is
therefore impossible — and a refresh whose rotated token is not written is
worthless.

The proxy is the only place that can do both: read **and** write cookies,
before every render. It therefore becomes the only rotation point, for **both**
kinds of token:

```ts
// proxy.ts of the consumer
export async function proxy(request: NextRequest) {
  return emporixTokenProxy(request, { siteCode: "main" });
}
```

`emporixTokenProxy` decodes the `exp` of the access token (base64, without
signature verification — Emporix does that), refreshes when expiry is near,
rotates the anonymous session when necessary, writes all affected cookies and
delegates site/language to the existing `emporixSiteProxy`.

That makes one question irrelevant which would otherwise be blocking: whether
Emporix invalidates the anonymous refresh token on use. The rotated one is
always written.

### 3. `withEmporixSession` — one helper instead of 49 wrappers

The inventory below counts **49 mutations in 18 hook files**. Shipping a server
action wrapper for each of them would be «one wrapper per operation» — the same
ceremony that was rejected for the service client.

Instead, two functions that bind the session:

```ts
/** For server components. Cookie writes are no-ops (a render must not write). */
export async function withEmporixSession<T>(
  fn: (client: EmporixClient, auth: AuthContext) => Promise<T>,
): Promise<T>;

/** For server actions and route handlers. Writes cookies. */
export async function withEmporixSessionMutable<T>(
  fn: (client: EmporixClient, auth: AuthContext) => Promise<T>,
): Promise<T>;
```

The consumer's server action becomes two lines, with full SDK typing:

```ts
"use server";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/bff";

export async function addToCart(cartId: string, item: CartItemInput) {
  return withEmporixSessionMutable((client, auth) =>
    client.carts.addItem(cartId, item, auth),
  );
}
```

**The branching on the inside is the actual value** and the reason why it does
not belong in 19 consumer files:

| Case | Client | AuthContext |
|---|---|---|
| Customer token in the cookie | memoized, `getEmporixClient({ tagged: false })` | `auth.customer(token)` |
| Guest | **per request**, with `attachAnonymousStore` over the cookie jar | `auth.anonymous()` |

The guest path needs one client per request, because `getEmporixClient()` is
memoized process-wide — a request store attached to it would let guest A's
session bleed through to guest B. That is the direct consequence of the
cart's session binding.

A side effect that counts: `withEmporixSession*` cannot deliver a tagged client
at all. The rule «never a customer call via the tagged client» — today «the one
rule» in the README — thus becomes **structural** again instead of documented.

### 4. Catalog proxy for client-side catalog interaction

Typeahead, infinite scroll and filters without a full page change want
client-side reads. For catalog data a proxy is the **better** solution, not
merely a permitted one:

- The data is public — there is no privilege to escalate.
- It is cacheable — Next's fetch cache absorbs the second hop after the first
  request, **once for all visitors** instead of once per browser. Net faster
  than the direct path.
- The allowlist already exists: `emporixTagsForUrl(url, tenant).length === 0`
  → 403. One line, building on 22 existing tests. The same function defines
  the cache boundary and the proxy boundary, because both need the same thing:
  the distinction public/personalized.

Client-side without any token at all:

```ts
new EmporixClient({
  tenant,
  credentials: { storefront: { clientId: "proxied" } },
  tokenProvider: createProxyTokenProvider(),  // placeholder, no network call
  fetch: createProxyFetch({ base: "/api/emporix" }),
});
```

`createProxyTokenProvider().getAnonymousToken()` returns a placeholder session,
**without** a network call. That way an anonymous token is never minted in the
browser — the blocker of the rejected sentinel path falls away, because no
token request happens at all. The route strips the placeholder header and
inserts the server's real anonymous token.

The group A react hooks below therefore remain usable client-side,
unchanged.

## Cookie contract

| Cookie | `httpOnly` | Rationale |
|---|---|---|
| `emporix.customerToken` | **yes** | only server components read it |
| `emporix.refreshToken` | **yes** | never reaches the browser |
| `emporix.saasToken` | **yes** | the checkout runs server-side, the `saas-token` header is set there |
| `emporix.cartId` | **yes** | nothing client-side needs it |
| `emporix.anonymousSession` | **yes** | contains a refresh token ([storage/index.ts:54](../../../packages/react/src/storage/index.ts#L54)); per guest, managed by the server |
| `emporix.activeLegalEntityId` | **yes** | the B2B switch is a server action |
| `emporix.siteCode`, `emporix.language` | no | no secrets; the proxy already writes them that way, and a consumer may keep mounting the provider for anonymous catalog browsing |

That makes **all** secrets httpOnly, and all of them work — unlike every
partial design in which the `saasToken` had to stay readable client-side.
F-01 is fully closed, F-13 fully closed on the client side.

Attributes: `path=/`, `sameSite=lax`, `secure` derived from the request protocol
(not hard-coded `true` — see F-04/F-05), `maxAge` bounded for the
customer token.

## CSRF

Only our own routes and server actions are exposed, because they are the sole
cookie-authenticated ones. The Emporix calls carry `Authorization: Bearer` and
**no** cookie (no `credentials` field in `http.ts`, default `same-origin`,
Emporix is a different origin) — a CSRF against `addToCart` at Emporix is
structurally impossible.

Chosen: **`sameSite=lax` + POST-only + an `Origin`/`Sec-Fetch-Site` check in the
factory.** A request is rejected on `Sec-Fetch-Site: cross-site` and when
*neither* `Sec-Fetch-Site` *nor* `Origin` is present — otherwise an attacker
would simply omit the header. Non-browser clients are rejected by this; for
these routes that is correct and will be documented.

`sameSite=strict` was rejected: a top-level return from a payment provider
would not send the cookie and the user would appear logged out. A
double-submit token was rejected because it solves nothing here that the
origin check does not already solve.

`assertSameOrigin(request)` is exported so that consumers can protect their own
state-changing route handlers with it. That closes out F-07.
Server actions come with Next's own origin check; route handlers do not.

## Hook inventory: 41 files, four groups

Complete, not exemplary. Classified by auth mode, read/mutation and whether
`emporixTagsForUrl` tags the URL.

### Group A — proxyable, stay usable client-side (8)

Anonymously readable **and** tagged.

`use-products` · `use-variant-children` · `use-categories` · `use-availability` ·
`use-availabilities` · `use-match-prices` · `use-match-prices-chunked` ·
`use-sites`

### Group B — anonymously readable, but **not** proxyable (3)

The most surprising finding of the inventory: no customer token needed, but not
cacheable and therefore not proxyable. Have to go into server components anyway.

| Hook | Service | why `[]` |
|---|---|---|
| `use-cart` (read part) | `carts` | mutable per shopper |
| `use-checkout` (read part) | `checkout` | per shopper |
| `use-shipping` | `shipping` | not in the tag list |

### Group C — customer-bound reads → server components (11)

`use-company` · `use-company-contacts` · `use-company-groups` ·
`use-company-locations` · `use-my-companies` · `use-my-orders` ·
`use-my-orders-infinite` · `use-order` · `use-my-segments` · `use-sales-order` ·
`use-customer-addresses` (read part)

### Group D — mutations → server actions (49 in 18 files)

Measured via `mutationFn` occurrences, not via `useMutation` lines (which count
the import as well).

| File | Mutations |
|---|---|
| `use-company-mutations` | 12 |
| `use-customer-addresses` | 5 |
| `use-shopping-lists` | 5 |
| `use-customer-credentials` | 4 |
| `use-cart` | 3 |
| `use-checkout` | 3 |
| `use-approvals`, `use-coupons`, `use-customer-profile`, `use-password-reset`, `use-session-context` | 2 each |
| `use-cancel-order`, `use-cloud-functions`, `use-order-transition`, `use-reorder`, `use-returns`, `use-reward-points`, `use-update-sales-order` | 1 each |

### Group E — no Emporix call, usable unchanged (4)

`use-company-switcher` · `use-site-context` · `use-customer-session` (only
orchestrates) · `use-product-media` (pure derivation)

### The honest price for the consumer

A typical B2C storefront writes around **19 server actions**: cart 3,
checkout 3, profile 2, addresses 5, session context 2, coupons 2,
password reset 2. B2B adds the 12 company mutations on top.

That is real work, but it falls on the **consumer**, not in the package, and
every action is two lines. Nobody needs all 49 — you write the ones the
storefront uses.

## Non-goals

- **No change to `packages/react`.** It remains fully in place as the SPA path,
  with the security profile the review describes.
- **No change to the SDK.** Every hook-in point is already public.
- **No client entry in the next package** for session purposes. The
  catalog proxy client (`createProxyTokenProvider`, `createProxyFetch`) is
  browser-capable and therefore needs an entry with a `"use client"` banner —
  that is the only new build effort.
- **No wrapper per operation.** Two helpers cover 49 mutations and 14 reads
  between them.
- **No catch-all proxy.** Catalog only, with `emporixTagsForUrl` as the allowlist.
- **No migration of the example in this spec.** The example shows the SPA path
  today; a second example for server-first mode is a follow-up cycle of its
  own.

## Tests

**Auth functions** (stubbed `globalThis.fetch`): login sets the
httpOnly cookies and **never** returns a refresh token in the body (the
security-relevant test) · login threads the anonymous token through · refresh
rotates · logout calls `customers.logout` and deletes every secret cookie ·
`assertSameOrigin` rejects `cross-site` · and rejects when both headers are
missing.

**Token proxy:** refreshes on an expiring `exp` · leaves a fresh token
untouched · rotates the anonymous session · writes no cookies when there is
nothing to do (no-op guard as with `emporixSiteProxy`) · delegates site/language
correctly.

**`withEmporixSession`:** customer → memoized client and `auth.customer` · guest
→ one client per request with an attached store and `auth.anonymous` · two
concurrent guests get **different** clients (the core claim of the
session binding) · `config.fetch` is `undefined`, so never tagged · the
read-only variant writes no cookies.

**Catalog proxy:** a tagged URL is let through · cart, order and
customer URLs return 403 · the placeholder header is replaced, never
passed on · `createProxyTokenProvider` makes **no** network call (the
test that proves «no token in the browser») · a foreign tenant returns 403.

**Guard:** as in the service cycle — the guard file throws, the `exports` map
has `react-server` and `default`, `files` includes it, plus the build
verification in both directions.

### What no unit test covers

The bundler condition itself, and the question of whether Emporix invalidates
the anonymous refresh token on use. The latter is irrelevant for this design
(the proxy always writes the rotated one), but it should be observed once in the
plan against the `viu` tenant so that the assumption is backed by evidence.

## Open questions

1. **Does Emporix rotate the anonymous refresh token on use, and does it
   invalidate the old one?** Not decision-relevant, see above, but to be observed.
2. **How often does the guest path refresh?** The store bootstraps with
   `expiresAt = 0`, so the first `getAnonymousToken()` per
   client instance performs a refresh. With one client per request that means one
   extra Emporix roundtrip per request that touches the cart. Whether that
   is a nuisance in practice has to be measured — the access token could later be
   carried in the cookie together with its expiry time to save most refreshes.
   Do not optimize up front.
3. **`maxAge` for the customer token.** F-02 records that there is no
   application-side timeout today. This mode is the opportunity to set one;
   the concrete value (8 h?) is a product decision.

## Relationship to the review findings

| Finding | Status after this mode |
|---|---|
| F-01 tokens in a JS-readable cookie | **closed** for Next storefronts; stays open for the SPA path, structurally unsolvable there |
| F-13 tokens in URLs | **closed** on the client side; Emporix' own logs remain |
| F-07 CSRF in consumer routes | **closed** via `assertSameOrigin` |
| F-02 no session lifetime | addressable, concrete value open (question 3) |
| F-03 no tenant namespace | **untouched** — its own cycle |
| F-04/F-05 diverging cookie attributes | partly: this mode derives `secure` and unifies the attributes for the new writes. The consolidation across all three write paths remains a cycle of its own. |
