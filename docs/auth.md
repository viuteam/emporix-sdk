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
  wires this up.

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

The SDK provides the **seam**, not the flow. Two options:

1. Do the exchange upstream and pass the resulting Emporix token via
   `auth.raw(jwt)` per call.
2. Inject a custom `tokenProvider` in the config; the SDK delegates `service`
   and `anonymous` resolution to it (implement
   `getToken`/`getAnonymousToken`).

Emporix's `POST /customer/{tenant}/exchangeauthtoken` is real but implementing
the full authorization-code/token-exchange flow is out of scope for the SDK.
