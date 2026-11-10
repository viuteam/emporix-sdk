---
"@viu/emporix-sdk-angular": minor
---

feat(angular): support a Backend for Frontend through `provideEmporix({ proxySession })`

For a client built with the SDK's new `proxy` option, `provideEmporix` now does the same as React's `customerSession: "proxy"`:

- **Storage.** It puts a view in front of `storage` whose token slots stay empty, so no token is ever written.
- **Customer paths.** They run on `PROXY_CUSTOMER_TOKEN`, a marker that is never sent, while `proxySession.authenticated` is true.
- **Companies.** No company context is bootstrapped, and a company switch reports an error.
- **`injectCustomerSession`.** `login` and `logout` call `proxySession.login` / `.logout` and reject without them. `confirmSignup` and `refreshSession` reject.

A 401 goes to the client's own `proxy.onUnauthorized`. Passing `proxySession` with a client that is not in proxy mode throws. See `docs/bff.md`.
