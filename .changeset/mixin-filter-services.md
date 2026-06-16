---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Wire the mixin filter builder into more services. `categories.search`,
`orders.listMine({ q })`, `customerAdmin.searchCustomers({ q })` and
`vendor.searchVendors({ q })` now accept a built mixin filter (or a raw `q`
string), each entity-gated via `QueryFor<E>` and routed through `resolveQuery`
(all are non-compound, so `or()` filters are rejected). New React hooks:
`useCategorySearch` and a `q` option on `useMyOrders`.
