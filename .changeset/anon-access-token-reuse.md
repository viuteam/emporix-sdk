---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-next": minor
---

Stop spending one Emporix token call per guest request.

`AnonymousSessionStore` may now carry the anonymous **access** token and its
expiry (`StoredAnonymousSession`: `{ refreshToken, sessionId, accessToken?,
expiresAt? }`), and `@viu/emporix-sdk-next` persists both in its httpOnly
session cookie. A server-side guest client lives for exactly one request, so its
in-memory token cache is always empty — before this, every single request redeemed
the refresh token for a token the guest already held. Emporix bills per API call,
and an anonymous token is valid for 3599 seconds on the `viu` tenant.

Measured with a request-counting stub, guest path, one business call per request:

| | before | after |
|---|---|---|
| first request of a session | 1 login | 1 login |
| every later request | 1 refresh | **0** |
| four `withEmporixSession` in one request | 4 refreshes | **0** |

A logged-in customer already cost zero token calls and still does —
`auth.customer(token)` is passed straight through and no anonymous token is ever
minted for them.

Both fields are optional and the two hosts choose oppositely on purpose: the
React storage adapters keep persisting **only** `{ refreshToken, sessionId }`,
because a browser client is long-lived and holds the token in memory anyway, so
writing it to `localStorage` would only expose a bearer token to JavaScript. A
test pins that.

`accessToken` counts only together with a future `expiresAt` — either alone is
treated as «no token», so a truncated or hand-edited record cannot make the SDK
send an empty bearer token. A stored token that the tenant revoked early, or one
an out-of-sync clock made look valid, comes back as a 401 that `HttpClient`
answers with `expireAnonymous()` plus one retry; the `sessionId` survives, so the
guest keeps their cart. Existing sessions keep working: a cookie written before
this release simply has neither field and refreshes exactly as it did.
