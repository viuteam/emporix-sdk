---
"@viu/emporix-sdk-react": minor
---

Order service hooks:

- Customer-facing: `useMyOrders`, `useMyOrdersInfinite`, `useOrder`, `useCancelOrder`, `useOrderTransition`, `useReorder`.
- Service-account (backoffice): `useSalesOrder`, `useUpdateSalesOrder` — inert when `auth` is undefined so storefront apps can import them for types without unexpected backend traffic.
- New `prefetchOrder` SSR helper alongside `prefetchProduct` / `prefetchCart`.
- `useMyOrders` / `useMyOrdersInfinite` default `legalEntityId` from `useActiveCompany`; explicit `null` disables. Switching the active company auto-invalidates order queries because `legalEntityId` is part of the cache key.
- `useReorder` is best-effort: item-level failures during cart repopulation land in `errors[]` instead of throwing; the mutation returns `{ added, errors }`.
