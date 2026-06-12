---
"@viu/emporix-sdk-react": patch
---

fix logout to purge the entire `["emporix"]` query-cache namespace. Previously only the `customer` and `cart` keys were removed, so customer-scoped caches without a user discriminator (payment modes, order lists) survived logout and could be served to the next logged-in customer straight from cache.
