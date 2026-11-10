# Backend for Frontend (proxy mode)

In proxy mode the browser holds no Emporix token at all. A Backend for Frontend
(BFF) on the same origin keeps the tokens in its server-side session and attaches
them to every call it forwards to Emporix. The SDK sends its requests to that
proxy, `/emporix/**` for example, and never asks for a token itself.

This is the BFF architecture of [RFC 10017 (BCP 212), OAuth 2.0 for
Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017). The SDK
side is in `@viu/emporix-sdk`, `@viu/emporix-sdk-react` and
`@viu/emporix-sdk-angular`. The BFF itself is yours to build.

## When, and why

Use it when a token readable by JavaScript is not acceptable. Every other
browser setup of this SDK keeps at least an anonymous access token in memory,
and after a login a customer token in the storage you chose. Script injected
into your page (XSS, or a compromised dependency) can read either one and use it
from anywhere until it expires.

With a BFF, the only credential in the browser is an `HttpOnly` session cookie.
Script cannot read it. It can still make calls from inside the page while it
runs, but it cannot take a token away and keep using it.

What it costs:

- **A server in every request path.** Every Emporix call goes through the BFF.
- **Login and logout become navigations** to the BFF's own endpoints, for
  example `/bff/login` and `/bff/logout`. The SPA never calls an Emporix auth
  endpoint.
- **Some session work moves to the BFF:** see [What stays with the
  BFF](#what-stays-with-the-bff).

If you run Next.js, `@viu/emporix-sdk-next`'s server-first mode solves the same
problem inside Next (see [next.md](./next.md)). Proxy mode is for an SPA (React,
Angular or plain) with a BFF of its own.

## How a request travels

```
browser                         BFF (same origin)                      Emporix
──────────────────────────      ─────────────────────────────────      ────────────────
GET /emporix/customer/t/me  →   checks X-CSRF and the session cookie
Cookie: bff-session=…           drops Cookie and Authorization
X-CSRF: 1                       adds Authorization: Bearer <token>  →  GET /customer/t/me
(no Authorization)                                                  ←  200 {…}
                            ←   drops Set-Cookie, passes the body
```

Without a valid session the BFF answers `401`. The SDK reports it, and the app
sends the browser to `/bff/login`.

## SDK

```ts
import { EmporixClient } from "@viu/emporix-sdk";

const client = new EmporixClient({
  tenant: "acme",
  host: "/emporix", // the BFF's proxy path, resolved against location.origin
  credentials: {}, // nothing to configure: the BFF holds the client ids
  proxy: {
    headers: { "X-CSRF": "1" },
    onUnauthorized: () => location.assign(`/bff/login?returnUrl=${encodeURIComponent(location.pathname)}`),
  },
});
```

| Option | Default | |
|---|---|---|
| `proxy.headers` | `{}` | Sent with every request. |
| `proxy.credentials` | `"same-origin"` | `fetch`'s `credentials`, so the session cookie goes along. Use `"include"` only for a BFF on another origin. |
| `proxy.onUnauthorized` | — | Called with `{ method, path }` on every 401, before the error is thrown. |

What changes with `proxy` set:

| | Without `proxy` | With `proxy` |
|---|---|---|
| `Authorization` header | `Bearer <token>` | never sent, not even one passed in per request |
| Token requests (anonymous login and refresh, client credentials, customer refresh) | as needed | none. The token provider throws if asked |
| `auth.customer(token)`, `auth.anonymous()`, `auth.raw(token)` | choose the token | accepted, but they no longer decide anything on the wire |
| `auth.service()` | client-credentials token | throws `EmporixAuthError` before any request |
| 401 | re-authenticate or refresh once, then throw | `onUnauthorized`, then `EmporixAuthError`. No retry |
| `host` | absolute URL | may also be a path, resolved against `globalThis.location.origin` per request |
| `Emporix-Tenant`, `Accept-Language`, `Content-Language` | sent | sent, unchanged |

The proxy headers and `credentials` apply to all three request paths: JSON
calls, raw responses (`media.download`, `quotes.generatePdf`) and server-sent
event streams (`ai.chatStream`, `imports` run events).

Other parts of the client:

- **`client.onUnauthorized(listener)`** subscribes to the same 401s and returns
  the unsubscribe function. The React provider uses it.
- **Refused options.** With `proxy`, `tokenProvider`, `credentials.backend` and
  `credentials.custom` throw at construction. Each would sit unused, and a
  backend secret in a browser bundle is exactly what proxy mode exists to
  prevent.
- **Relative host on a server.** It has no `location` to resolve against, so a
  request there throws a clear error. Code that renders on the server needs an
  absolute host and its own way to authenticate.

## React

```tsx
<EmporixProvider
  client={client}
  proxySession={{
    authenticated: user !== null, // from your BFF, e.g. GET /bff/user
    login: () => location.assign("/bff/login"),
    logout: () => location.assign("/bff/logout"),
  }}
  onCustomerSessionExpired={() => location.assign("/bff/login")}
>
  <App />
</EmporixProvider>
```

`customerSession` defaults to `"proxy"` for a client built with `proxy`.
Setting it to `"owned"` or `"external"` with such a client throws, and so does
`"proxy"` with a client that has none.

**Is a customer logged in?** The provider does not find out by itself; the app
passes `proxySession.authenticated`. Asking through the proxy would not work:
`customers.me()` for a guest session answers 401, which would send every guest
to the login page. Most BFFs have an endpoint for this (`/bff/user`); call it
before you render.

**What the hooks do:**

- Customer-gated hooks run while `authenticated` is `true`. Their auth context
  carries `PROXY_CUSTOMER_TOKEN`, a marker that is never sent.
  `useCustomerSession().customerToken` and `useEmporix().storage.getCustomerToken()`
  return the same marker, so checks such as `isAuthenticated` keep working.
- The provider puts a view in front of your `storage`. Cart id, site, language
  and active legal entity pass through to your storage. The token slots
  (customer token, anonymous session, refresh token, SaaS token) read as empty,
  and writes to them are dropped. Nothing writes a token to your storage, and no
  anonymous session is stored.
- No customer token is refreshed. `autoRefreshCustomerToken` and
  `initialCustomerToken` throw.
- `onCustomerSessionExpired` fires on every 401 the proxy answers. Parallel
  requests call it once each.
- No company context is bootstrapped. `useActiveCompany().setActiveCompany`
  rejects, because switching the legal entity re-scopes a token that only the
  BFF holds.

**`useCustomerSession`:**

| | In proxy mode |
|---|---|
| `login(input)` | runs `proxySession.login` (`input` is ignored). Rejects without it |
| `logout()` | clears the cart id, active legal entity and query cache, then runs `proxySession.logout`. Rejects without it |
| `socialLogin`, `exchangeToken`, `refreshSession` | reject: each would put a customer token into the browser |
| `signup`, `refresh` | unchanged, through the proxy |
| `refreshToken`, `saasToken` | `null` |

**Hooks that always run anonymously** (`usePasswordReset`,
`useConfirmEmailChange`, `useResendActivation`) run through the proxy with
whichever token the BFF attaches. They work in a guest session if your
allowlist forwards their paths. `useConfirmSignup` rejects, because the session
it returns is a set of tokens.

## Angular

```ts
const user = await fetch("/bff/user", { headers: { "X-CSRF": "1" } }).then((r) => (r.ok ? r.json() : null));

bootstrapApplication(AppComponent, {
  providers: [
    provideEmporix({
      client, // built with `proxy`, as above
      proxySession: {
        authenticated: user !== null,
        login: () => location.assign("/bff/login"),
        logout: () => location.assign("/bff/logout"),
      },
    }),
  ],
});
```

The behaviour matches React's:

- The storage view, the marker, `login` and `logout` delegation, and no company
  bootstrap work the same way.
- `confirmSignup` and `refreshSession` reject.
- `authenticated` is fixed per injector. A login or logout through the BFF is a
  navigation, so the app bootstraps again anyway.
- Angular has no provider-level 401 callback. Use the client's
  `proxy.onUnauthorized`.

## What the BFF has to do

The SDK can only keep tokens out of the browser if the BFF does its part. Each
item below closes a specific hole.

1. **Check `X-CSRF` on every proxied request** and answer `401` or `403`
   without it. A cross-site form or `<img>` cannot set a custom header, and a
   cross-site `fetch` that sets one needs a CORS preflight that the BFF does not
   grant. The session cookie should be `SameSite=Lax` or `Strict` as well.
2. **Replace `Authorization`.** Drop whatever header comes in, then set your own
   `Authorization: Bearer <token>`: the customer token for a logged-in session,
   otherwise an anonymous token you minted server-side.
3. **Drop the `Cookie` header** before forwarding. The session cookie is for the
   BFF, not for Emporix.
4. **Drop `Set-Cookie` from Emporix responses**, so the upstream cannot set
   cookies on your origin.
5. **Forward an allowlist of paths, not everything under `/emporix/`.** List the
   operations your storefront calls, and nothing that returns a token. Never
   forward these:
   - `/oauth/token`
   - `/customerlogin/auth/anonymous/*`
   - `/customer/{tenant}/login`, `/refreshauthtoken`, `/socialLogin`,
     `/exchangeauthtoken`
   - the signup opt-in confirmation

   Their responses carry tokens, and forwarding them would hand tokens to the
   page. Keep back-office paths out too.
6. **Own the token lifecycle:**
   - mint the anonymous token server-side, refresh both token kinds, and answer
     `401` when there is no valid session;
   - mint the anonymous token with the site, currency and target country
     (`siteCode`, `currency`, `targetLocation`). `prices.matchByContext`
     resolves against that context and returns `[]` without it. The SPA's
     `setCurrency` / `setSite` still patch the session context through the
     proxy, but they cannot re-mint the token.
7. **Attach `saas-token` for customer checkout.** In proxy mode
   `useCustomerSession().saasToken` is `null`, so `useCheckout().placeOrder()`
   sends no `saas-token` header. Add the customer's SaaS token to the checkout
   paths yourself.
8. **Pass through** `Emporix-Tenant`, `Accept-Language`, `Content-Language`,
   `Content-Type` and the body, and do not buffer `text/event-stream` responses.

## What stays with the BFF

These are deliberately not done by the SDK in proxy mode:

- **Guest cart after login.** In owned mode, `login` merges the guest cart into
  the customer cart. With a BFF the login is a navigation, so do the merge in
  the BFF's login callback: `POST /cart/{tenant}/carts/{customerCartId}/merge`
  with the guest cart id. Then point the SPA at the customer cart. On the
  client, `client.carts.getCurrent(auth.customer(PROXY_CUSTOMER_TOKEN), { siteCode, create: true })`
  through the proxy returns its id.
- **Switching the legal entity (B2B).** It re-scopes the customer token
  (`refreshauthtoken?legalEntityId=…`), so it needs an endpoint on the BFF.
- **Server-side rendering.** A relative host only resolves in a browser, so
  server code needs a client with an absolute host and its own authentication.

## Related

- [auth.md](./auth.md): token kinds and the SDK-managed flows that proxy mode
  turns off
- [react.md](./react.md#provider) and [angular.md](./angular.md#setup): provider
  setup
- [next.md](./next.md): the Next.js equivalent, without a separate BFF
