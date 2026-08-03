---
"@viu/emporix-sdk-next": patch
---

Fixes a logged-in customer being shown a cart they do not own.

`emporixLogin`'s cart onboarding merges the guest cart into the customer's, then
stores the customer cart's id. The merge, however, fails **every time a guest
cart is involved**: a customer token cannot see an anonymous cart, so Emporix
answers `404 Cart with code … not found`. Measured against a live tenant on
2026-08-03; the merge in this code path has never succeeded.

That 404 escaped to the onboarding's own best-effort `catch` and took the id write
with it. The session therefore kept pointing at the guest cart, and the cart the
customer actually owns stayed invisible — including its items. Nothing surfaced
the reason, because the catch was there to keep a bad cart from costing someone
their login.

The merge now has its own `catch`, so the adoption happens either way. What the
customer sees after logging in is their own cart.

**Known limitation:** the guest cart's items stay behind. Closing that gap needs
an answer to which token may fold an anonymous cart into a customer's — the
customer token demonstrably may not, and using a service account inside a login
flow is a decision rather than a patch.
