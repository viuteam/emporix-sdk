# SDK Shape Normalization — Design

**Status:** Draft for review
**Date:** 2026-06-04
**Scope:** `@viu/emporix-sdk` (and a thin `@viu/emporix-sdk-react` follow-on)

## Goal

Move the wire/response-shape handling that the storefront demo currently does in
its `adapters.ts` into the SDK **where it is a genuine SDK correctness gap** — so
every consumer gets faithful, correctly-typed data — while leaving genuine
**presentation** concerns in the consumer.

## In scope vs out of scope

**In scope (SDK):**
- Price-match response `itemId` (codegen type says `itemRef`, runtime returns `itemId`).
- Order-v2 `Order`/`OrderItem` types (hand-written mirror diverged from the real API).
- `products.searchByName(term)` convenience (build the Emporix `q` filter).
- `productIdFromYrn(yrn)` util (parse a product id out of an `itemYrn`).

**Out of scope (stays in the consumer — presentation policy, not wire fidelity):**
- Locale selection from a localized map (`pickText`) — the SDK returns the map faithfully.
- HTML sanitization (`sanitizeHtml`) — trust/context dependent.
- View-model shaping / null-safe defaults / money formatting.

## Decided approach (from brainstorming)

- **Hybrid:** correct the type where the type is simply wrong; map at the service
  layer where the deployed API diverges from a source the codegen can't fix.
- **Additive + `@deprecated`:** anything replaced is kept (and now populated) and
  marked deprecated → no breaking change, minor version bumps.
- **Live verification is mandatory.** The generated/mirrored types have proven
  unreliable; every field mapping is verified against the live `viu` tenant, not
  trusted from the OpenAPI doc.

## Verified findings (2026-06-04, live `viu`)

The two candidates are **opposite situations** — this drives their different fixes.

### Price-match (`POST /price/{tenant}/match-prices-by-context`)
- SDK type `MatchResponse` is **codegen'd** and faithfully mirrors the OpenAPI doc,
  which declares `itemRef: { itemType, id }`.
- The **live API returns `itemId`** (no `itemRef` at all), and richer than documented:
  `itemId` carries a localized `name`; the row also has `priceModel`, `tierValues`,
  `includesTax`, `location`, `site`, `tax`, `metadata` beyond `priceId`/
  `effectiveValue`/`totalValue`/`originalValue`/`currency`/`quantity`.
- **Conclusion:** the **OpenAPI spec is stale** vs the deployment. The codegen'd
  `itemRef` is always `undefined` at runtime. Codegen cannot fix this until Emporix
  updates the spec → a **service-layer normalization** is justified.

### Orders (`GET /order-v2/{tenant}/orders` and `/orders/{id}`)
- SDK type is a **hand-written mirror** (`order-v2/types.gen.ts`, header: *"Not
  generated … replaced by codegen output when the OpenAPI input lands"*). It invents
  `items`, top-level `orderNumber`, `totalPrice: {amount,currency}`, `payment`
  (singular), `OrderAddress.zip`.
- The **OpenAPI doc is correct** and matches the live API: `entries` (required),
  `totalPrice`/`subTotalPrice` `type: number` marked **deprecated** (use
  `calculatedPrice`), `calculatedPrice` required, `orderNumber` under
  `mixins.generalAttributes`.
- The live **list and single-GET return the identical shape** (no divergence).
- **Conclusion:** the wrong artifact is only the hand-written mirror. The clean fix
  is to **codegen `order-v2` from the real spec** (replacing the mirror), exactly as
  the header anticipates.

### Codegen mechanism (verified)
`packages/sdk/scripts/generate.ts` iterates `packages/sdk/specs/*.yml`, runs
`@hey-api/openapi-ts` (types only) → `src/generated/<filename>/`, and prepends the
AUTO-GENERATED banner. 35 services each ship a `.yml`; only **`order-v2`,
`customer-management`, `iam`** are hand-written — **because their `.yml` is simply
missing** from `specs/`. SalesOrder types are therefore **not generated either**:
both `OrdersService` and `SalesOrdersService` import the same hand-written
`generated/order-v2` mirror. Adding `specs/order-v2.yml` (one Order-Service spec
covers both `/orders` and `/salesorders`) and running `generate` replaces the mirror
in place — imports (`../generated/order-v2`) stay stable.

### Live order shape (single-GET == list), reference
Top-level keys: `id, status, created, lastStatusChange, cartId, entries[],
discounts[], customer, billingAddress, shippingAddress, payments[], shipping{total,
lines}, tax{lines,total}, subTotalPrice(number), totalPrice(number),
totalAuthorizedAmount(number), currency, siteCode, countryCode, calculatedPrice,
feeYrnAggregate, restriction, metadata{version,mixins}, mixins{payments,
generalAttributes{orderNumber, extendedOrderStatus, customerFirstOrder}}`.

Entry keys: `id, itemYrn, type, amount, orderedAmount, effectiveQuantity,
originalAmount, originalPrice, unitPrice(number), totalPrice(number),
calculatedUnitPrice, calculatedPrice, product{id,sku,name,localizedName,description,
images,productType,published}, tax, price{priceId,currency,originalAmount,
effectiveAmount}, totalDiscount, fees, metadata, mixins, priceMatchDetails`.

## Candidate 1 — Price-match `itemId` (Phase 1)

**Fix:** a pure `normalizeMatch(raw)` in `PriceService`, applied to the results of
`match`, `matchByContext`, `matchByContextChunked`. It:
- exposes `itemId: { itemType?, id?, name? }` as the canonical field (already on the wire);
- keeps `itemRef` (the documented field) **populated** by mirroring `itemId`, marked
  `@deprecated` — so existing `itemRef` consumers start working and new ones use `itemId`;
- surfaces the richer live fields the codegen type omits (at minimum `priceModel`,
  `tierValues`, `includesTax`, `location`, `site`, `tax`) — additive, "return as much
  as possible".

**Type:** export a curated `PriceMatch` (superset over the codegen `MatchResponse`)
with `itemId` added and `itemRef` deprecated. Non-breaking.

## Candidate 2 — Order types from the real spec (Phase 2)

**Preferred fix (concrete):**
1. Obtain the **Order Service OpenAPI spec** from Emporix (developer portal —
   confirmed available; it documents `entries`/`calculatedPrice` etc. correctly).
2. Save it as `packages/sdk/specs/order-v2.yml` (filename = output dir → keeps
   `../generated/order-v2` imports stable). One spec covers both `/orders` and
   `/salesorders`.
3. `pnpm -F @viu/emporix-sdk generate` → replaces the hand-written mirror with
   generated types.
4. **Re-export churn:** the generated component names won't match the hand-invented
   `Order`/`OrderItem`/`OrderMoney`. Update the service re-exports/aliases and the
   façade accordingly. Replace the fictional order test fixtures with the real shape.

**Fallback (only if the spec truly cannot be obtained):** hand-correct the mirror to
the verified live shape below — still a single source shared by both services.

**Corrected `Order` shape (faithful to the live API, "as much as possible"):**
- `entries` (not `items`); `orderNumber` is **derived note**: on the wire it lives in
  `mixins.generalAttributes.orderNumber` — codegen will expose `mixins`; the demo/
  consumer reads it (or we add a curated convenience later, see Open Questions).
- `totalPrice`/`subTotalPrice` are numbers (deprecated); the rich net/gross/tax source
  is `calculatedPrice`.
- `payments[]` (array), `shipping{total,lines}`, `tax{lines,total}`, `discounts[]`,
  `created`, `lastStatusChange`, `cartId`, `countryCode`, `totalAuthorizedAmount`,
  `calculatedPrice`, `feeYrnAggregate`, `restriction`, `metadata`, `mixins`.
- `OrderItem` (= entry): `id, itemYrn, type, orderedAmount/amount/effectiveQuantity,
  unitPrice(number), originalPrice, totalPrice(number), totalDiscount, price{priceId,…},
  product{id,sku,name,localizedName,description,images,…}, tax, calculatedUnitPrice,
  calculatedPrice, fees, metadata, mixins`.

The SDK delivers this faithfully (correct types); the demo's adapter keeps doing the
**presentation** shaping (Money objects, `productId` via `productIdFromYrn`,
`orderNumber` extraction, locale pick) — that stays in the consumer.

**`salesorders` GET** could not be verified (needs a service token; the demo has
none). Assumption: same order-v2 model → same shape. Verify with a service token
during implementation.

## Candidate 3 — `products.searchByName(term)` (Phase 3, additive)

Thin helper building `name:(~<regex-escaped>)` (the verified working filter), then
delegating to the raw `products.search` (which stays a `q`-passthrough, pinned by its
test). Prevents the "No value for key …" 400 the demo hit. Optional matching React
hook `useProductNameSearch` as a follow-on.

## Candidate 4 — `productIdFromYrn(yrn)` util (Phase 1, tiny)

Export a pure `productIdFromYrn(yrn): string` (parse `…;<productId>`). Used by the
order item mapping to populate `productId`, and by cart consumers. No auto-fetch.

## Mapping pattern

- One pure `normalize*(raw)` function per service, applied to the HTTP result before
  returning. Pure → unit-testable in isolation.
- Curated exported types are hand-curated supersets over the codegen/mirror types;
  the generated types remain the wire reference.
- For orders, codegen output replaces the mirror → the "mapping" is mostly the
  consumer's presentation layer, not an SDK transform (only `mixins.generalAttributes`
  conveniences, if any, would be SDK-side).

## Testing

- **TDD**, MSW with the **verified live shapes** as fixtures (not the old fictional
  mocks — e.g. the existing order test mock with `items`/`{amount,currency}` must be
  replaced with the real `entries`/numeric shape).
- Assert: canonical field present, `@deprecated` mirror populated, richer fields
  surfaced.
- **Live re-verify** each shape against `viu` before finalizing (incl. `salesorders`
  with a service token, and the order list with a non-`IN_CHECKOUT` status once a
  finalized order exists).

## Phasing (each its own branch + changeset + PR)

1. **Phase 1** — Price-match `normalizeMatch` (`itemId` canonical, `itemRef`
   deprecated-but-populated, richer fields) + `productIdFromYrn` util. Small, high value.
2. **Phase 2** — Orders: obtain spec → codegen → replace mirror (or hand-correct to the
   verified shape); shared by `OrdersService` + `SalesOrdersService`; replace the
   fictional test fixtures. Larger.
3. **Phase 3** — `products.searchByName` (+ optional React hook). Additive convenience.

## Versioning

Additive + `@deprecated` throughout → **minor** bumps. The order codegen swap may
remove invented fields (`items`, top-level `orderNumber`, `payment`) that never
matched runtime; since they were never populated correctly, treat as additive/fix
where possible, otherwise a clearly-noted minor with migration notes.

## Open questions / prerequisites

1. ~~**order-v2 OpenAPI spec file** — obtainable?~~ **Resolved:** Emporix publishes the
   Order Service OpenAPI; the codegen just needs `specs/order-v2.yml` added. (Confirm
   the exact spec covers `/salesorders/{id}` too — same service, expected yes.)
2. **`salesorders` GET shape** — verify with a service token (assumed identical).
3. **Order list with other statuses** — verify shape against a finalized order.
4. **`orderNumber` convenience** — expose a curated top-level `orderNumber` (from
   `mixins.generalAttributes`) in the SDK, or leave it to the consumer? (Lean: leave to
   consumer to keep the SDK faithful to the wire; revisit if many consumers need it.)
5. **Report the price spec discrepancy** (`itemRef` vs `itemId`) to Emporix so the
   normalization can eventually be retired.
