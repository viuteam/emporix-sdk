# Order Service (Customer Foundation) — Design Spec

**Date**: 2026-05-26
**Status**: Approved (brainstorming) → ready for writing-plans
**Scope**: Sub-Spec #1 of the Order initiative. Sub-Spec #2 covers B2B shared-orders (depends on #1 + B2B Foundation), #3 covers `/salesorders` admin reads + list, #4 covers order split.

## Goal

Give the SDK a customer-facing Order surface — list, detail, status transitions, cancel — plus a minimal service-account update path so backends can patch `status`/`mixins` on an existing order without dragging in the whole `/salesorders` admin surface. Wire React hooks for storefront consumers and a small SSR prefetch helper.

## Non-Goals

- `/salesorders` listing + filtering — that's the admin scope for Sub-Spec #3.
- Order split (vendor marketplace) — Sub-Spec #4.
- Returns API — separate Emporix service, separate spec.
- Order events / webhooks — `event-bus` service, separate spec.
- Pick-Pack endpoints (`/pick-pack/{tenant}/...`) — back-office, not storefront.
- Client-side status-transition validation (state machine). Server is the source of truth; an invalid transition surfaces as `EmporixValidationError`.

## Background

Today the SDK can *create* orders (via `client.checkout.placeOrder`, which returns `CheckoutResult` carrying an `orderId`) but cannot *read*, *update*, or *cancel* them. Emporix exposes orders through two adjacent endpoints with different auth models:

- `/order-v2/{tenant}/orders/*` — customer-token surface (own order history, status transitions).
- `/order-v2/{tenant}/salesorders/*` — service-token surface (merchant read + patch).

The customer endpoints additionally accept a `saas-token` header (paired with a customer token) for tenants that enforce dual-token reads — same header `checkout.placeOrder` already sends.

## Decisions (from brainstorming)

| # | Decision | Why |
|---|---|---|
| D1 | Two flat facades: `client.orders` (customer) + `client.salesOrders` (service) | Each facade is auth-coherent; mirrors API path split; keeps `client.orders` mental model clean for storefront authors. |
| D2 | `cancel(id)` is a thin alias for `transition(id, "DECLINED")`; both ship | DX — cancel is the common case, transition is the escape hatch for any future status flow. |
| D3 | `saas-token` is **explicit opt-in** via `opts.saasToken` on each call | Maximum caller control, no implicit reach into session state. Mirrors how `checkout.placeOrder` already handles it. |
| D4 | `useMyOrders({ legalEntityId? })` defaults `legalEntityId` from `useActiveCompany`; explicit prop wins | "I see orders for the company I'm acting on behalf of." Server token is LE-scoped anyway; query param is explicit and goes into the cache key for auto-invalidation on switch. |
| D5 | Service-account `update` is restricted to a single resource patch (`PATCH /salesorders/{id}`); no `list`/`get` admin reads | Smallest useful seam for backend tools (mixins, status). The full admin read surface is Sub-Spec #3. |
| D6 | `useReorder` ships as a best-effort helper (fetch order → iterate items → `cart.addItem`); partial failures surface as `{ added, errors }` | Emporix has no atomic reorder endpoint. Documenting partial-success up front avoids confusing UIs. |
| D7 | No clientside transition state-machine | Server enforces; mirroring it would drift. UI disables based on `status`; the server returns 400/422 on illegal transitions. |
| D8 | Unit tests (MSW) + `vite-spa` Order-History page; E2E deferred | Same gate as B2B Foundation — `viu` tenant order fixtures land in their own follow-up. |

## Architecture

### Layers

```
EmporixClient
  ├─ orders        (OrdersService — customer)
  └─ salesOrders   (SalesOrdersService — service-token)
```

No new React Context. Order hooks read `useActiveCompany` for the default `legalEntityId`, and `useEmporix` for client + storage; otherwise they're plain queries/mutations.

### SDK service surface

All new façades live in `packages/sdk/src/services/` and are re-exported from `packages/sdk/src/orders.ts`. Generated types live under `packages/sdk/src/generated/order-v2/`.

#### `client.orders` (customer)

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `listMine(auth, opts?)` | `GET /order-v2/{tenant}/orders` | `customer`/`raw` | `opts: { pageNumber?, pageSize?, status?, legalEntityId?, saasToken? }` |
| `get(orderId, auth, opts?)` | `GET /order-v2/{tenant}/orders/{id}` | `customer`/`raw` | `opts: { saasToken? }` |
| `transition(orderId, status, auth, opts?)` | `POST /order-v2/{tenant}/orders/{id}/transitions` | `customer`/`raw` | Body `{ status }`. `opts: { saasToken?, comment? }` |
| `cancel(orderId, auth, opts?)` | (delegates to `transition`) | `customer`/`raw` | Helper — passes `"DECLINED"` |

#### `client.salesOrders` (service-token)

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `get(orderId, auth, opts?)` | `GET /order-v2/{tenant}/salesorders/{id}` | `service`/`raw` | Single-resource read for "after PATCH, fetch fresh". |
| `update(orderId, patch, auth, opts?)` | `PATCH /order-v2/{tenant}/salesorders/{id}?recalculate=` | `service`/`raw` | `patch: SalesOrderPatch`; `opts: { recalculate?: boolean }` |

`saas-token` is sent as the `saas-token` header when `opts.saasToken` is present. `siteCode` is sent as a query param when `opts.siteCode` is present (only on `listMine`).

Pagination follows the existing `PaginatedItems<T>` convention from `core/context`. `listMine` returns `PaginatedItems<Order>`.

### SDK changes to existing code

| File | Change |
|---|---|
| `packages/sdk/src/services/orders.ts` | New — both service classes (`OrdersService` and `SalesOrdersService`) in one file. |
| `packages/sdk/src/orders.ts` | New façade re-export. |
| `packages/sdk/src/generated/order-v2/{types.gen.ts,index.ts}` | New — hand-rolled order schema with the standard "pending codegen" header. |
| `packages/sdk/src/client.ts` | New `readonly orders: OrdersService` and `readonly salesOrders: SalesOrdersService`. New `ServiceName` entries `"orders"` and `"sales-orders"` for logger scoping (or one shared `"order"` — see Open Questions). |
| `packages/sdk/src/core/logger.ts` | Add the new `ServiceName` member(s). |
| `packages/sdk/src/index.ts` | `export * from "./orders"`. |
| `packages/sdk/package.json` | New subpath export `./orders`. |
| `packages/sdk/tsup.config.ts` | New entry `src/orders.ts`. |

### Order shape

Hand-rolled in `packages/sdk/src/generated/order-v2/types.gen.ts`:

```ts
export type OrderStatus =
  | "CREATED"
  | "IN_CHECKOUT"
  | "CONFIRMED"
  | "SHIPPED"
  | "COMPLETED"
  | "DECLINED";

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  totalPrice: { amount: number; currency: string };
  subTotalPrice?: { amount: number; currency: string };
  shippingPrice?: { amount: number; currency: string };
  taxAggregate?: { lines: Array<{ rate: number; amount: number }> };
  items: OrderItem[];
  customer?: OrderCustomer;
  billingAddress?: OrderAddress;
  shippingAddress?: OrderAddress;
  payment?: OrderPayment;
  delivery?: OrderDelivery;
  siteCode?: string;
  legalEntityId?: string;
  channel?: string;
  metadata?: {
    version: number;
    createdAt: string;
    modifiedAt: string;
    mixins?: Record<string, unknown>;
  };
  mixins?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
}

export interface OrderItem {
  id: string;
  productId: string;
  productCode?: string;
  productName?: string | Record<string, string>;
  imageUrl?: string;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  totalPrice: { amount: number; currency: string };
}

export interface OrderCustomer {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  guest?: boolean;
}

export interface OrderAddress {
  contactName?: string;
  companyName?: string;
  street?: string;
  streetNumber?: string;
  zip?: string;
  city?: string;
  country?: string;
}

export interface OrderPayment {
  paymentMode?: string;
  paymentStatus?: string;
  transactionId?: string;
}

export interface OrderDelivery {
  deliveryDate?: string;
  trackingNumber?: string;
  carrier?: string;
}

export interface OrderTransition {
  status: OrderStatus;
  comment?: string;
}

export interface SalesOrderPatch {
  status?: OrderStatus;
  mixins?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
  metadata?: { version: number; mixins?: Record<string, unknown> };
}
```

Mixins/customAttributes stay `Record<string, unknown>`. Apps with their own mixin schema can intersect via TypeScript at call sites (no generic on `Order` for now — keeps the SDK surface stable).

`OrderItem` is intentionally separate from `CartItem` even though they look similar — Cart and Order schemas diverge over time (Order has no `yrn`, Cart has no `productCode` in all places), so cloning the shape is safer than re-using.

### React hooks

Customer-side (`packages/react/src/hooks/`):

```ts
useMyOrders(opts?: {
  pageSize?: number;
  pageNumber?: number;
  status?: OrderStatus;
  legalEntityId?: string;   // default: from useActiveCompany; null = no filter
  saasToken?: string;
}) → UseQueryResult<PaginatedItems<Order>>

useMyOrdersInfinite(opts?: {
  pageSize?: number;
  status?: OrderStatus;
  legalEntityId?: string;
  saasToken?: string;
}) → UseInfiniteQueryResult<PaginatedItems<Order>>

useOrder(
  orderId: string | undefined,
  opts?: { saasToken?: string },
) → UseQueryResult<Order>

useCancelOrder()
  → UseMutationResult<void, unknown, string>
                                  // mutate(orderId)

useOrderTransition()
  → UseMutationResult<void, unknown, {
      orderId: string;
      status: OrderStatus;
      comment?: string;
    }>

useReorder()
  → UseMutationResult<
      { added: number; errors: unknown[] },
      unknown,
      { orderId: string }
    >
```

Service-account-side (exported alongside, intended for backoffice tools):

```ts
useSalesOrder(
  orderId: string | undefined,
  auth: AuthContext | undefined,
) → UseQueryResult<Order>

useUpdateSalesOrder()
  → UseMutationResult<Order, unknown, {
      orderId: string;
      patch: SalesOrderPatch;
      auth: AuthContext;        // required at mutate-time
      recalculate?: boolean;
    }>
```

Auth handling: `useSalesOrder` is **disabled when `auth` is undefined** (caller is responsible for providing a service-token context, typically `auth.service()` after configuring `credentials.backend`). `useUpdateSalesOrder` accepts `auth` per-mutation invocation; the mutation throws synchronously if it's missing. The hooks intentionally do *not* default to `auth.service()` so storefront apps that don't have backend credentials can import the hook for type-completeness without unexpectedly firing service-token reads.

Query-key shape:

```
["emporix", "orders", "mine", { tenant, authKind, siteCode, legalEntityId, status, pageSize }]
["emporix", "orders", orderId, { tenant, authKind }]
["emporix", "salesorders", orderId, { tenant, authKind }]
```

`legalEntityId` in the mine-key + B2B Foundation's predicate-based invalidator means `setActiveCompany` flushes the order list automatically.

Mutation hooks invalidate on success:

- `useCancelOrder` / `useOrderTransition` → invalidate `["emporix","orders"]` (predicate: any key starting with `"orders"`).
- `useUpdateSalesOrder` → invalidate `["emporix","salesorders", orderId]` plus `["emporix","orders", orderId]` (customer-side view also refetches).

`useReorder` flow:

1. `qc.fetchQuery` on the order's customer-view key — cache hit if `useOrder` is already mounted, otherwise one read.
2. Resolve active cart id from storage (same path `useCartMutations` uses).
3. For each `OrderItem`: call `client.carts.addItem(cartId, { product: { id }, quantity }, ctx)`.
4. Aggregate: `{ added: N, errors: Error[] }`. Mutation never throws on item-level failures — UI shows partial-success.
5. On success, invalidate `["emporix","cart"]`.

### Errors

Reuses the existing error hierarchy — no new error types:

| HTTP | Mapped to |
|---|---|
| 401 | `EmporixAuthError` |
| 403 with `missing scope:` body | `EmporixInsufficientScopeError` (from B2B Foundation) |
| 403 without scope hint | `EmporixForbiddenError` |
| 404 | `EmporixNotFoundError` |
| 400 / 422 | `EmporixValidationError` (e.g. invalid transition) |
| 5xx | `EmporixServerError` (retry with backoff via existing `HttpClient`) |

### Storage

No new keys. Order ids are not persisted (server is source of truth, React-Query caches read results). Storage interface unchanged.

### SSR

New helper in `packages/react/src/ssr.ts`:

```ts
export async function prefetchOrder(
  qc: QueryClient,
  client: EmporixClient,
  orderId: string,
  authCtx: AuthContext,
  opts?: { saasToken?: string },
): Promise<void>;
```

Mirrors `prefetchProduct` / `prefetchCart`. No `prefetchMyOrders` for now (YAGNI — pagination + filter combos would explode the prefetch matrix; add when a concrete RSC use case appears).

`EmporixProvider` props unchanged.

### Telemetry

No new event types. Reads + mutations flow through the existing `cache.*` / `query.*` / `mutation.*` channels. Mutation keys are namespaced (`["emporix","orders","cancel"]`, `["emporix","orders","transition"]`, `["emporix","orders","reorder"]`, `["emporix","salesorders","update"]`) so consumers can filter.

## Test plan (unit only)

`packages/sdk/tests/services/orders.test.ts`:

- `listMine` — Bearer + path; `legalEntityId`/`pageNumber`/`pageSize`/`status` query params; `opts.saasToken` becomes `saas-token` header.
- `get` — happy path; 404 → `EmporixNotFoundError`.
- `transition` — POST body `{ status, comment? }`; 400 → `EmporixValidationError`.
- `cancel` — wrapper: hits transitions endpoint with `{ status: "DECLINED" }`.

`packages/sdk/tests/services/sales-orders.test.ts`:

- `get` — Bearer + service-auth context only (rejects customer).
- `update` — PATCH body roundtrip; `?recalculate=false` when `opts.recalculate === false`; 403 with scope hint → `EmporixInsufficientScopeError`; 403 without → `EmporixForbiddenError`.

`packages/react/tests/`:

- `use-my-orders.test.tsx` — disabled without customer token; default `legalEntityId` from `useActiveCompany`; explicit prop wins; `saasToken` opt-in.
- `use-my-orders-infinite.test.tsx` — multi-page fetch; `hasNextPage` cursor.
- `use-order.test.tsx` — single fetch + cache-key shape.
- `use-cancel-order.test.tsx` — mutateAsync POSTs to transitions; invalidates `["emporix","orders"]`.
- `use-order-transition.test.tsx` — explicit `status` argument; same invalidation.
- `use-reorder.test.tsx` — fetched Order → addItem per line-item → `{ added, errors }`; partial failure (1 OK, 1 discontinued) produces an `errors[]` entry instead of throwing.
- `use-sales-order.test.tsx` — `get` + `update` with service auth context; invalidates both salesorder + customer-order keys.
- `use-cancel-order.b2b.test.tsx` — switch active company → query-key invalidation propagates.

MSW handlers in the test files (same pattern as existing tests). Shared default mocks for `/customerlogin/auth/anonymous/login` so `CompanyContextProvider` bootstrap doesn't trip on unmocked requests.

## Example update

`examples/vite-spa/`:

- `src/pages/OrderHistory.tsx` — `useMyOrdersInfinite({ pageSize: 10 })`; list of `{ orderNumber, createdAt, status badge, totalPrice }`.
- `src/pages/OrderDetail.tsx` — `useOrder(id)`; items table; Cancel button (visible only when `status === "CREATED"`) wired to `useCancelOrder`; Reorder button wired to `useReorder`; surfaces `{ added, errors }` as a toast.
- `src/App.tsx` — routes `/account/orders` and `/account/orders/:id`; nav link added.

`next-app-router` and `node-server` stay unchanged.

## Docs update

- New `docs/orders.md` — concepts, status lifecycle, customer vs sales facades, `saas-token` opt-in behaviour, reorder partial-success semantics, `prefetchOrder` for SSR.
- `docs/auth.md` — one-line append: `saas-token` may also be used on `client.orders.*` reads (link).
- `docs/react.md` — hook listings extended (mirrors the D3/D4 doc-refresh approach).
- `CLAUDE.md` — workspace service list adds `Orders`, `SalesOrders`; storage keys unchanged.
- Root `README.md` — service tally bump.

## Release

`pnpm changeset`:

- `@viu/emporix-sdk` minor — *"`OrdersService` + `SalesOrdersService`; order-v2 types; `./orders` subpath."*
- `@viu/emporix-sdk-react` minor — *"Customer order hooks (`useMyOrders`/`useMyOrdersInfinite`/`useOrder`/`useCancelOrder`/`useOrderTransition`/`useReorder`); service-account hooks (`useSalesOrder`/`useUpdateSalesOrder`); `prefetchOrder` SSR helper; company-aware order query keys."*

Examples are in the `.changeset/config.json` ignore list — no entries needed.

Commitlint: scopes used here are `sdk`, `react`, `docs`, `examples`, `repo`, `release` — all in the allowlist.

## Open questions

1. **Logger ServiceName**: one shared `"order"` or two (`"orders"` + `"sales-orders"`)? Two would give finer log-level control; one matches the API "module" naming. Default suggestion: **two** (`"orders"` and `"sales-orders"`).
2. **`update` response**: Emporix's `PATCH /salesorders/{id}` returns the patched resource. We type it as `Order`. If a tenant strips fields in the patch response, callers can pass `opts.followGet: true` to chain `salesOrders.get` after the patch. **Out of scope for now** — easy to add later if it bites.

## Out of scope (sub-specs to follow)

| Sub-spec | What | Depends on |
|---|---|---|
| #2 B2B shared-orders | Same `/orders` endpoint with company-scope behaviour; dedicated `useCompanyOrders` hook | this spec + B2B Foundation |
| #3 Sales-orders admin | `/salesorders` list/filter/sort + bulk patches | this spec |
| #4 Order split | `POST /split`, master/suborders | #3 |
| Returns | Emporix Returns service (separate API) | unrelated to this |
| Order events | `event-bus` subscriptions on status changes | unrelated to this |
