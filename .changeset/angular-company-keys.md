---
"@viu/emporix-sdk-angular": patch
---

Key the cart, the cart bootstrap, the payment modes and the customer addresses on the active company, as the React bindings do. A switch between two companies dropped the cart id, which put `injectActiveCart` back on its «no cart yet» cache entry — still fresh, not invalidated, and holding the previous company's cart. Payment modes (10-minute stale time) and addresses, which the switch does not invalidate, kept the previous company's answer too.
