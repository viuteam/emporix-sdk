---
"@viu/emporix-sdk-next": minor
---

The browser-side proxy entry is `@viu/emporix-sdk-next/public-client`, not
`/catalog-client`, and its route factory is `createEmporixPublicRoute` rather
than `createEmporixCatalogRoute`.

Neither was published — both are new on the branch that introduced them — so
there is nothing to migrate.

`catalog` named the first use case, not the rule. Two problems came with it:

- **Wrong scope.** The route allows exactly what `emporixTagsForUrl` yields tags
  for, which is the "public and cacheable" test: `product`, `category`, `price`,
  `availability` and `site`. Prices and site configuration are not what anyone
  calls catalog data.
- **Name collision.** Emporix has a real Catalog service, exposed as
  `client.catalogs`. `catalog-client` read as a client for it. It is not.

`createProxyTokenProvider` and `createProxyFetch` keep their names — they do
proxy.
