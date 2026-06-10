---
"@viu/emporix-sdk": patch
---

Fix customer order history showing no orders. `GET /order-v2/{tenant}/orders` returns a bare JSON array (the total count lives in the `X-Total-Count` header), but `OrdersService.listMine` cast that array straight to `PaginatedItems<Order>` without wrapping it — so at runtime `.items` was `undefined` and `useMyOrders` / `useMyOrdersInfinite` (and any order-history UI) rendered no orders even when the API returned them. `listMine` now normalizes the array into the shared `{ items, pageNumber, pageSize, hasNextPage }` envelope, like every other paginated service.
