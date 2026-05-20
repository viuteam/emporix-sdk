# Authentication

## Token kinds

| Kind | Who owns it | How it's obtained |
| --- | --- | --- |
| `service` | SDK | `POST /oauth/token` `client_credentials` with `credentials.backend` (or a named `custom` set). No refresh token — re-auth on expiry. |
| `anonymous` | SDK | `GET /customerlogin/auth/anonymous/login?tenant&client_id` using `credentials.storefront.clientId` (no secret). Carries a `sessionId`; refreshed via `/anonymous/refresh` to keep the same session. |
| `customer` | Caller | `POST /customer/{tenant}/login` returns it (SDK maps wire `accessToken` → `customerToken`, also exposes `saasToken`, `refreshToken`). |
| `raw` | Caller | An exact token, passed through verbatim — escape hatch for SSO / token-exchange. |

> **`saasToken`** (from `customers.login()`) is a separate JWT, **not** an
> `AuthContext`. It is required as the `saas-token` header for a logged-in
> customer checkout — see [`checkout.md`](./checkout.md). The SDK redacts it
> from all logs.

Build them with `auth.service(name?)`, `auth.anonymous()`,
`auth.customer(token)`, `auth.raw(token)`. The `AuthContext` is the **last
argument of every service method** and is **never stored on the client** — one
`EmporixClient` safely serves many concurrent shoppers (SSR, edge, multi-tenant
single process).

## SDK-managed vs caller-managed

- **SDK-managed** (`service`, `anonymous`): the SDK fetches, caches, and on a
  401 invalidates → refreshes → retries **once**. Anonymous refresh uses the
  refresh endpoint so `sessionId` is preserved.
- **Caller-managed** (`customer`, `raw`): returned verbatim; a 401 is **not**
  retried — it propagates as `EmporixAuthError` so you can re-login or refresh
  externally. `customers.refresh({ refreshToken, saasToken? })` is available
  when you choose to (authorized with an anonymous token; same `sessionId`,
  no new `saas_token`). In React, `useCustomerSession().refreshSession()`
  wires this up. `customers.logout(auth)` invalidates the customer token
  server-side (`GET /customer/{tenant}/logout`); `useCustomerSession().logout()`
  does this best-effort before clearing the local session.

## Persisting anonymous sessions

The SDK can persist the anonymous refresh token + `sessionId` across page
reloads. Wiring is automatic when you use `EmporixProvider` from
`@viu/emporix-sdk-react` together with a persistent `EmporixStorage` backend
(`createLocalStorageStorage()` or `createCookieStorage()`).

How it works:

- On mount, `EmporixProvider` calls `client.tokenProvider.attachAnonymousStore`
  with an adapter that reads/writes `EmporixStorage.getAnonymousSession` /
  `setAnonymousSession`.
- On the first anonymous-token need, `DefaultTokenProvider` seeds its in-memory
  session from the store. The seeded session has `expiresAt: 0`, which forces
  the next call to take the **refresh** path — preserving `sessionId`.
- After every successful refresh or fresh login, the SDK writes the rotated
  `{ refreshToken, sessionId }` back to the store.
- On `invalidateAnonymous()`, the SDK calls `store.write(null)`.

Implication for storefronts: a guest cart created in one tab is still
accessible after a browser reload (or a new tab) for as long as the refresh
token is valid (Emporix: 24h). If the refresh fails (expired), the SDK falls
back to a fresh login (new `sessionId`) and the old cart becomes inaccessible
— surface this as a "discard cart" UI prompt.

**Security note:** the anonymous refresh token is stored client-side
(`localStorage` or a non-HttpOnly cookie) and is exposed to XSS in the same way
the customer access token is. The 24-hour TTL limits damage. The SDK never
puts it in a custom header or URL outside of the `/anonymous/refresh` call.

The same wiring is offered via the `AnonymousSessionStore` interface in
`@viu/emporix-sdk`; non-React hosts can implement it directly.

## The anonymous → login → cart-merge flow

The anonymous token's `sessionId` is what links a guest cart to the customer
after login. `customers.login(creds, { anonymousToken })` threads the anonymous
token so the session (and its cart) survives — **omitting it silently creates a
new session and loses the cart** (this is why the Emporix Java SDK warns about
it). After login, merge with:

```ts
await sdk.carts.merge(anonymousCartId, auth.customer(customerToken));
```

`carts.merge` requires a `customer` context (the merge target is the customer's
cart). In React, `useCustomerSession().login` and the cart hooks coordinate this
for you.

## Per-method defaults

See the table in [`../packages/sdk/README.md`](../packages/sdk/README.md#authcontext-per-method).
Cart methods have **no default** — you must pass `customer` or `anonymous`
explicitly; the SDK refuses to guess which cart to act on.

## Custom credential sets

```ts
new EmporixClient({
  tenant: "t",
  credentials: {
    backend: { clientId, secret },
    custom: { partner: { clientId, secret, scope: "product.product_read" } },
  },
});
await sdk.products.list(undefined, auth.service("partner"));
```

## SSO / token exchange

The SDK supports both Emporix customer SSO flows directly:

- **Authorization Code (SSO):** the storefront performs the IdP redirect and
  PKCE itself, then calls `customers.socialLogin({ code, redirectUri,
  codeVerifier?, sessionId? })` (default `anonymous` auth). Emporix has no
  `/authorize` endpoint — only the code exchange is the SDK's concern.
- **RFC 8693 Token Exchange:** `customers.exchangeToken({ subjectToken,
  config? })` exchanges an external IdP JWT for an Emporix session (default
  `anonymous` auth; `config` selects a per-site IdP config).

Both return a `CustomerSession` (the caller then uses `auth.customer(token)`),
and `useCustomerSession().socialLogin` / `.exchangeToken` store it like
`login`. Registering the IdP / trusted issuer is a manual Emporix-support
provisioning step, not an SDK config. Note the platform quirk: `expires_in`
is a string from `socialLogin` and an integer from `exchangeToken` — the SDK
normalizes both to a number. `auth.raw(jwt)` and a custom `tokenProvider`
remain available for any flow the SDK does not model.
