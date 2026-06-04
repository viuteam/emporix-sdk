---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": patch
---

feat(sdk): generate order-v2 types from the real OpenAPI spec

Replaces the hand-written `order-v2` type mirror (which invented `items`,
`{amount,currency}` totals and a top-level `orderNumber`) with codegen output
from the vendored Emporix Order Service spec. `OrdersService` and
`SalesOrdersService` now return the real API shape:

- line items are `entries` (not `items`); each entry has `itemYrn`,
  `orderedAmount`/`amount`, and a nested `product`
- `totalPrice`/`subTotalPrice` are numbers + a top-level `currency`; rich
  net/gross/tax lives in `calculatedPrice`
- `orderNumber` is under `mixins.generalAttributes`
- `SalesOrderPatch` is now `Partial<OrderUpdateDto>` (the real PATCH body)

Public type surface: `Order`, `OrderEntry`, `OrderStatus`, `SalesOrder`,
`Transition`, `SalesOrderPatch`. The unused fictional re-exports (`OrderItem`,
`OrderMoney`, `OrderCustomer`, `OrderAddress`, `OrderPayment`, `OrderDelivery`,
`OrderTaxLine`, `OrderMetadata`, `OrderTransition`) are removed — they had no
runtime counterpart.

`useReorder` now reads `entries` and re-adds each with its `itemYrn` + price row
(`priceId`/amounts/currency) — the cart requires a price, so the previous
`{ product: { id } }` body always failed; reorder now actually works.
