---
"@viu/emporix-sdk-next": patch
---

Fixes a logged-in customer being shown a cart they do not own.

`emporixLogin`'s cart onboarding merges the guest cart into the customer's, then
stores the customer cart's id. When that merge fails, the failure used to escape
to the onboarding's best-effort `catch` and take the id write with it — so the
session kept pointing at the guest cart while the cart the customer actually owns
stayed invisible, items included. Nothing surfaced the reason, because the catch
exists to keep a bad cart from costing someone their login.

The merge now has its own `catch`, so the adoption happens either way.

**How often this bites:** rarely, which is why it went unnoticed. In the ordinary
guest→login flow the customer inherits the guest's session, `getCurrent` answers
with that same cart, the ids match, and the merge is skipped — the cart survives
untouched. The merge is attempted only when the ids differ, i.e. when the customer
already holds another open cart. That state is reachable: log out with items in
the cart, come back as a guest, add something, log in.

And when it is attempted, it fails: a customer token cannot see an anonymous cart,
so Emporix answers `404 Cart with code … not found`. Measured against a live
tenant on 2026-08-03.

**Known limitation:** in that case the guest cart's items stay behind. Closing the
gap needs an answer to which token may fold an anonymous cart into a customer's —
the customer token demonstrably may not, and putting a service account in the login
path is a decision rather than a patch.

`onboardCustomerCart` in `@viu/emporix-sdk-react` has the same shape and the same
gap; it is not changed here.
