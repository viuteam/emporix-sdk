---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
"@viu/emporix-sdk-angular": minor
---

**Type change — `salesOrders.update` resolves to `void`.** The `PATCH` answers `204` without a body, so it always resolved to `undefined` despite promising an `Order`. `useUpdateSalesOrder` (React) and `updateSalesOrder` of the Angular order mutations follow; both still invalidate the sales-order queries, so a mounted read refetches the order. Code that read the result was already broken; it now fails to compile instead.
