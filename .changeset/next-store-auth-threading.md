---
"@viu/emporix-sdk-next": patch
---

Fixes store mode for logged-in customers. `emporixLogin`, `emporixRefresh` and
`emporixLogout` built their cookie jar without the `store` option, so in store
mode they silently ran on cookies however the caller was configured.

The effect was not a leak but a break: login wrote `customerToken`,
`refreshToken` and `saasToken` into real browser cookies, while
`emporixSession({ store })` read the store record — which had none of them — and
reported the visitor as anonymous. Logged in, and every reader said logged out.

`emporixLogout` hit the cookie-mode `destroy()` no-op, so the store record
survived the logout. The 0.4.0 notes claimed it destroyed the record. It did not.

Guest mode was never affected: it runs through `withEmporixSessionMutable`, which
threads the option correctly. That is also why the feature verified clean — every
store-mode check was a guest flow.

Five tests cover it, each failing before the fix. One of them asserts that
`emporixLogin` leaves **exactly one** session record: it builds two jars for one
request, and that only works because the first flush sets the sid cookie before
the second jar hydrates.
