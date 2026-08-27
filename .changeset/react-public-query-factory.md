---
"@viu/emporix-sdk-react": minor
---

feat(react): export the query factory so consumers can wrap back-office operations

`useEmporixQuery` and `useEmporixInfinite` are now exported from the package
root, with an `EmporixQueryConfig` type for the first. Nothing changes for
existing hooks — this only removes the `internal` boundary.

**Why:** the hooks here cover the storefront, which is roughly a quarter of the
SDK's ~490 operations. The rest are back-office calls — brands, labels, catalogs,
tax, fees, schemas, webhooks, invoices, quotes, vendors, imports, tenant config —
with no hook, because a storefront token cannot make them. Of 48 SDK service
files, 21 have no hook at all.

A **Managed Dashboard** module is the case where that token *can*. The host passes
a customer token whose scopes reach those operations, so wrapping one is a
five-line hook — but until now the factory that makes it correct was private, and
the only option was a hand-rolled `useQuery` whose cache key sits outside
`["emporix"]` and therefore misses both the scoped invalidation and the
provider's query defaults.

Angular's `injectEmporixQuery` has been public since its first release. This
closes that asymmetry, and a test now holds it open.

`useEmporixInfinite` is thinner than the query factory and its JSDoc says so: it
takes a `queryKey` you build and resolves no auth, because it predates the query
factory and every caller inside this package already had both. Build the key with
`emporixKey` from `@viu/emporix-sdk` so it matches the rest of the cache.

The README's Managed Dashboard section now documents the whole path, including
the trap that most admin facade methods default their `auth` parameter to a
**service** context — client credentials with a secret, which a browser does not
have. Always pass the context the factory hands you.
