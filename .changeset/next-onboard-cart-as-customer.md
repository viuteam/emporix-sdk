---
"@viu/emporix-sdk-next": patch
---

Fixes the guest-to-customer cart merge in **store mode**. A shopper who filled a
cart as a guest and then logged in landed on an empty cart; their items stayed on
the guest cart, unreachable.

`emporixLogin`'s cart onboarding calls `withEmporixSessionMutable`, which builds
its **own** jar and branches on whether a customer token is stored. In cookie mode
`persistSession` writes through, so that jar sees the token and runs as the
customer. In store mode it only touched the in-memory record — so the second jar
read a store with no token yet and ran as a **guest**.

Two consequences followed from that one branch:
`carts.getCurrent(ctx, { create: true })` created a fresh anonymous cart instead of
returning the customer's, and the merge never reached Emporix at all — the SDK's
own `requireCustomerAuth` rejected the anonymous context locally.

`emporixLogin` now flushes before onboarding. Measured against a live tenant on
2026-08-03: a guest cart with one product, a customer already holding three, and
after login the cart showed **4 items** under the customer's id.

Cookie mode was never affected. A test asserts the fix on the store's **write
order** — the customer token has to reach the store before the final write —
because the request list cannot distinguish the two paths.
