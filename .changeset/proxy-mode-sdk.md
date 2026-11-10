---
"@viu/emporix-sdk": minor
---

feat(sdk): add a proxy mode for a Backend for Frontend that holds the tokens

`EmporixConfig.proxy` (`{ headers?, credentials?, onUnauthorized? }`) runs the client behind a same-origin Backend for Frontend (BFF), the architecture of RFC 10017 (OAuth 2.0 for Browser-Based Applications). The browser then holds no token at all.

With it set, the client:

- requests no token: no anonymous login or refresh, no client credentials, no customer refresh;
- sends no `Authorization` header on any request — JSON calls, raw responses and server-sent event streams alike;
- sends `proxy.headers` (for example `{ "X-CSRF": "1" }`) and `fetch`'s `credentials` (default `"same-origin"`) on all three;
- answers a 401 by calling `proxy.onUnauthorized` and every listener registered with the new `client.onUnauthorized(listener)`, then throwing `EmporixAuthError`, without a retry.

`auth.customer()` and `auth.anonymous()` are still accepted but decide nothing on the wire. `auth.service()` throws before any request is made. `tokenProvider`, `credentials.backend` and `credentials.custom` throw at construction. `host` may now be a path such as `/emporix`, resolved against `location.origin` per request.

Also new: `createProxySessionStorage` and `PROXY_CUSTOMER_TOKEN`, the storage view the React and Angular bindings use, and `createProxyModeTokenProvider`. Without `proxy` nothing changes. See `docs/bff.md`.
