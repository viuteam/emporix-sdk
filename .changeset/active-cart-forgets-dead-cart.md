---
"@viu/emporix-sdk-angular": patch
---

fix(angular): `injectActiveCart` forgets a cart the server no longer has

Emporix closes a cart when its order is placed, so another device still holding that id gets a 404 on every read. `injectCart` already dropped the id on that 404, but `injectActiveCart` reads the stored id through its own bootstrap query and did not. An app following the `docs/angular.md` snippet — `injectActiveCart({ create: true })` plus `injectCartMutations()`, no `injectCart` — stayed on the closed cart for good: a stale id is not `null`, so the create path never ran.

`injectActiveCart` now forgets the id the same way: only on a 404, and only while it is still the stored one. The cleared id re-keys the bootstrap, which creates a fresh cart with no error state in between. Any other error keeps the id. Cart writes still never forget, because Emporix answers a missing cart item with the same 404.
