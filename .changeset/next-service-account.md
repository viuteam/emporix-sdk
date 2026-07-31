---
"@viu/emporix-sdk-next": minor
---

New entry `@viu/emporix-sdk-next/service` with `getEmporixServiceClient`, for
server-side writes with a dedicated Emporix service account.

```ts
export const service = getEmporixServiceClient({
  credentials: {
    productWriter: { clientId: "…", secret: "…", scope: "product.product_create" },
  },
});
await service.products.create(input, {}, auth.service("productWriter"));
```

Returns a plain `EmporixClient`, memoized per option set, so the SDK's token
handling applies: one cached token per credential set, reused until `expires_in`
minus a 60-second buffer, behind a single-flight lock. All of that lives on the
client instance, so the memoization is the feature — a client built inside a
handler body fetches a token per request.

**Importing this entry from a `"use client"` module fails the build.** The entry
carries a secret, so its `exports` map resolves to a throwing file outside the
server graph. Verified against a real Turbopack build: the client import fails in
the `app-client` and `app-ssr` layers, while Route Handlers, Server Actions and
Server Components resolve normally. No `server-only` dependency was added — the
package still has none.

Note that the error arrives at build time rather than in your editor.
TypeScript does not understand the `react-server` condition, so `types` resolves
unconditionally to the real declarations; otherwise `tsc` would fail even in a
legitimate Route Handler.

**No `tagged` option, deliberately.** A service client never receives a `fetch`,
because Next's fetch cache does not key on `Authorization` and a cached
privileged GET would be served to other visitors. No `context` option either:
`context` belongs to `StorefrontCredentials`, and a service client has none.

A credential set with an empty `clientId` or `secret` is rejected up front with
the set name. An unset environment variable yields `""`, which Emporix answers
with a 401 that reads like a permissions problem.
