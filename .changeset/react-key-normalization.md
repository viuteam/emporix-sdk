---
"@viu/emporix-sdk-react": minor
---

Query-key normalization for the last two hand-keyed read hooks.

**`useAvailability` / `useAvailabilities` — cache-invalidating.** Both now build
their key through `emporixKey` like every other read hook:

```
before: ["emporix", "availability", { tenant, productId, siteCode, anon, defaultAvailableOnNotFound }]
after:  ["emporix", "availability", productId, siteCode, defaultAvailableOnNotFound, { tenant, authKind }]
```

Existing cached availability entries are orphaned and refetch once. Auth
behaviour is unchanged: the hooks still read anonymously unless you pass
`customerToken`, and a token in storage does not change that. They are now
prefetchable via `prefetchEmporix` — see the descriptor table in `docs/react.md`.

**`prefetchEmporix` gains `mode` — not cache-invalidating.** `"customer"` keys
`authKind: "customer"` regardless of the context kind, matching customer-gated
hooks like `useOrder` and `useMyOrders`. `prefetchOrder` now sets it, which fixes
prefetching with an `auth.raw(jwt)` context — that previously keyed `"raw"` and
the hook never found the entry. With `auth.customer(token)` the key is unchanged,
so nothing is orphaned by this half.
