---
"@viu/emporix-sdk": minor
---

Add Emporix Shipping Service bindings (Phase 1 — config) via `client.shipping`:
sites (`findSites`), zones and methods (full CRUD), cost/quote (`quote`,
`quoteMinimum`, `quoteSlot`), shipping groups, and customer-group relations.
Server-side only — these use the service (clientCredentials) token. Delivery
scheduling (windows, times, slots, cycles) is not yet bound.
