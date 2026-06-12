---
"@viu/emporix-sdk": minor
---

add `createEmporixClient(config, services)` — a tree-shakeable, opt-in client factory that instantiates only the service classes you pass (e.g. `{ products: ProductService, carts: CartService }`), so bundlers drop every service you don't use. Service classes now carry static `channel`/`deps` metadata; `createCore(config)` exposes the shared infrastructure. `EmporixClient` is unchanged — it stays the batteries-included default that bundles everything — so this is purely additive.
