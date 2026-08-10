---
"@viu/emporix-sdk-react": minor
---

feat(react): accept a host-owned customer token

`customerSession="external"` tells `EmporixProvider` that the customer token was
handed in by a host application — an Emporix Managed Dashboard module, an
embedded admin UI. The SDK then never bootstraps a company context from it,
never attempts a refresh, reports a 401 through `onCustomerSessionExpired`, and
treats a changed `initialCustomerToken` as authoritative.

Also fixes a latent bug in the default `"owned"` mode: storage identity no
longer depends on `initialCustomerToken`, so delivering a new token stops
silently discarding `cartId`, `siteCode`, `language` and
`activeLegalEntityId`.

See the Managed Dashboard section in `packages/react/README.md` and the new
`examples/md-module`.
