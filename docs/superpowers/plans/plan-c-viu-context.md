# Plan C — viu live context (verified 2026-05-19)

Probed live with storefront client id
`miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO`.

- **siteCode:** `main`
- **currency:** `EUR`
- **targetLocation:** `DE` (valid countries: DE, CH, AT; `US` → 400 "Country not found")
- **sample catalog productId:** `69df9b7d78816f53657ba85b` (code `BASKET-001`,
  name `{ de: "Jordan Harden Vol. 8 Basketballtrikot" }`)

## Known tenant-data limitation (not an SDK issue)

`match-prices-by-context` returns `[]` for every catalog product on `viu`.
Cause: the price records in the Price service reference a **legacy numeric
product-id scheme** (e.g. `3441957`, `15536937`) while the current catalog
was re-imported with hex ids (e.g. `69df9b7d78816f53657ba85b`). The
intersection of priced item-ids and catalog product-ids is **empty**, and
the legacy priced ids 404 in the Product service.

Consequence for live verification (T6): the guest-checkout flow executes
correctly end-to-end (anonymous token with context → cart → add item →
`matchByContext` call succeeds, returns `[]`), but no price can be displayed
and an Emporix order may be rejected for a zero/priceless cart. The example
UIs render `—` for an unresolved price by design. This is a `viu` data
condition, not an SDK defect; the SDK behaviour (context binding, match call,
graceful empty handling) is correct.
