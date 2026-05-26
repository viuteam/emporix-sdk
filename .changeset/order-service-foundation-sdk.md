---
"@viu/emporix-sdk": minor
---

Order service (customer foundation):

- New `client.orders` — `listMine` / `get` / `transition` / `cancel` over the customer-facing `/order-v2/{tenant}/orders/*` endpoints. All methods accept an `opts.saasToken` forwarded as the `saas-token` header.
- New `client.salesOrders` — `get` / `update` over `/order-v2/{tenant}/salesorders/{id}` for backend / service-account use (status, mixins, custom attributes patches). `update` accepts `opts.recalculate` (server default `true`).
- New hand-rolled `Order`, `OrderItem`, `OrderStatus`, `OrderTransition`, `SalesOrderPatch` types (pending real codegen).
- New subpath export `@viu/emporix-sdk/orders`.
- New `client.carts.addItemsBatch(cartId, items, auth)` — wraps `POST /cart/{tenant}/carts/{cartId}/itemsBatch` (cap 200 items per call). Per-entry status surfaces partial failures via the generated `BatchResponse` shape.

No breaking changes. The full `/salesorders` admin list, order split, returns, and order events are deferred sub-specs.
