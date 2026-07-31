---
"@viu/emporix-sdk": minor
---

`EmporixConfig.fetch` — replace the global `fetch` used for API requests.

```ts
const sdk = new EmporixClient({ tenant, credentials, fetch: myFetch });
```

Useful for tracing, test doubles, custom retry policies, and framework-level
caching (`@viu/emporix-sdk-next` uses it to attach Next cache tags).

Client-level rather than per-request: the 596 `http.request` call sites in
`services/` each build their own `RequestOptions` literal, so a per-request
`fetchOptions` field would reach none of them.

Token requests and SSE deliberately keep using the global `fetch`: a cached
token response would be a security defect, and caching an event stream is
meaningless. Both are therefore structurally uncacheable, not merely uncached by
convention.
