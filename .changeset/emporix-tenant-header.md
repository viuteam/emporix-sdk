---
"@viu/emporix-sdk": minor
---

fix(sdk): send `Emporix-Tenant` on every request

The tenant is already in the path of nearly every endpoint, so this header looks
redundant. It is not: Emporix validates dashboard and IAM user tokens against it
and answers **401** without it, even when `Authorization: Bearer …` is correct.

Found while embedding the SDK in a Management Dashboard perspective. Every read
and write failed with 401 despite a valid host-supplied token, and nothing in
the request looked wrong — the header is simply absent from the SDK's
`buildHeaders`, which is not a diagnosable symptom.

`@emporix/api-calls`, the client library the Management Dashboard itself uses,
sets the header whenever a tenant is known — it is an Emporix convention, not a
dashboard-only quirk. So this is unconditional rather than opt-in: `HttpClient`
emits it whenever `tenant` is set, and `createCore` always passes it. Every
client built through `createEmporixClient` gets it.

**Behaviour change for every consumer.** Storefront traffic now carries one
extra header on each request. It is placed *before* `RequestOptions.headers`, so
a caller can still override it per request — the same escape hatch
`Accept-Language` has. Only `Authorization` remains non-negotiable.

`HttpClientOptions.tenant` is optional so a bare `new HttpClient(...)` stays
constructible; the header is then omitted entirely, matching what
`@emporix/api-calls` does with an empty tenant.

Also covers `requestStream` — it shares `buildHeaders`. Token requests
(`core/auth.ts`) are unaffected, as with `EmporixConfig.fetch`.
