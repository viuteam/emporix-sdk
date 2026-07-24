---
"@viu/emporix-sdk": minor
---

Add price admin CRUD to `client.prices`: flat prices
(`create`/`list`/`get`/`upsert`/`delete`/`search`/`bulkCreate`/`bulkUpsert`),
`prices.models` (price models CRUD), and `prices.lists` (price-list CRUD +
search + nested price-list prices incl. bulk create/upsert/delete). Every admin
method defaults to `service` auth (override allowed). The existing `match*`
methods are unchanged.
