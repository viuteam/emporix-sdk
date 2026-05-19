# Plan C — viu live context (verified 2026-05-19)

Probed live with storefront client id
`miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO`.

## Working price context (user-supplied, verified)

- **siteCode:** `main`
- **currency:** `CHF`
- **targetLocation:** `CH`
- **priced productId:** `0f1e2d3c-4b5a` — name
  `{ de: "Just-in-Time Zugriff (JIT)", en: "Just-in-Time Access (JIT)" }`,
  resolved priceId `691b27c9940f3e6dbbee71a8`, effectiveValue `1`.

`prices.matchByContext` via the SDK (anonymous token with the context above)
returns the full generated `MatchResponse` for this product — **price
resolution through the SDK is verified working end-to-end.**

## Verified guest-checkout sequence (live, via the SDK)

1. anonymous token with `{ currency: CHF, siteCode: main, targetLocation: CH }` — ✅
2. `carts.create({ currency: "CHF" })` → `{ cartId }` (generated `CartCreated`) — ✅
3. `prices.matchByContext({ items:[…] })` → real `priceId`/`effectiveValue` — ✅
4. `carts.addItem(cartId, { itemYrn, quantity, price }, anonymous)` — ✅
   **Emporix resolves the cart product via `itemYrn`**
   (`urn:yaas:hybris:product:product:{tenant};{productId}`), not `product.id`,
   for this price-only item. `price.priceId` + `effectiveAmount` are required.
5. `checkout.placeOrder` — requires, on the `viu` tenant:
   - customer `firstName`/`lastName` (guest still needs a name),
   - **real `shipping.methodId` / `zoneId`** from the tenant's Shipping
     service (placeholders → `400 "Invalid methodId/zoneId"`).
   These are tenant-configuration values the integrator supplies; the SDK
   sends the generated `RequestCheckout` faithfully. Every validation the
   tenant raised was a data/config requirement, never an SDK defect.

## Earlier catalog note (still true, context only)

`viu`'s plain catalog products (hex ids like `69df9b7d…`, e.g. `BASKET-001`)
have **no** price — the Price service's older entries use a legacy numeric
id scheme disjoint from the current catalog. The user-supplied
`0f1e2d3c-4b5a` is a price-bearing (non-plain-catalog) item, which is why it
must be added via `itemYrn`.

## SDK correctness fixes driven by this verification

- `CartService.create` now returns generated `CartCreated` (`{ cartId, yrn }`),
  not the `Cart` GET model.
- Both example guest-checkout flows use the verified pattern: CHF/main/CH
  context, match-then-add, `itemYrn`, customer name; shipping ids flagged as
  integrator-supplied.
