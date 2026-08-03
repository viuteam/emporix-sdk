---
"@viu/emporix-sdk-next": minor
---

`emporixLogin` now adopts the customer's cart and merges the guest cart into it,
matching what `@viu/emporix-sdk-react` already does on login.

This fixes a crash found in live testing: a customer whose `emporix.cartId`
cookie was absent — after a checkout closed the previous cart, or after the
cookie expired — fell through to `carts.create`, and Emporix answered **409
Conflict**, because a customer may hold only one open cart. Login now calls
`carts.getCurrent({ create: true })`, which returns the existing cart or makes
the first one.

The merge is the other half: a guest who fills a cart and then logs in keeps
those items instead of silently losing them.

Both are best-effort — a cart in a bad state never costs the customer their
login — and both are skipped when no `siteCode` is configured, since
`getCurrent` requires one.
