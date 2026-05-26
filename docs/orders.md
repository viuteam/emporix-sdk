# Orders

> Available since `@viu/emporix-sdk@<next minor>` and `@viu/emporix-sdk-react@<next minor>`.

## Concepts

- **Order** — a paid or pending shopping outcome with an `OrderStatus`: `CREATED`, `IN_CHECKOUT`, `CONFIRMED`, `SHIPPED`, `COMPLETED`, `DECLINED`.
- **Customer endpoints** (`/order-v2/{tenant}/orders/…`) — the storefront-user view. Customers can list/read their own orders, transition (e.g. `DECLINED` = cancel from `CREATED`).
- **Sales-order endpoints** (`/order-v2/{tenant}/salesorders/…`) — the merchant/service-account view. Backends patch status, mixins, and custom attributes after fulfilment.

## Status lifecycle

```
CREATED ─┬─ CONFIRMED ─ SHIPPED ─ COMPLETED
         └─ DECLINED
IN_CHECKOUT ─┬─ CREATED
             └─ DECLINED
```

`COMPLETED` and `DECLINED` are terminal. The SDK does **not** validate transitions clientside — the server rejects illegal moves with `EmporixValidationError` (HTTP 400/422).

## SDK

```ts
client.orders.listMine(auth, opts?)
client.orders.get(orderId, auth, opts?)
client.orders.transition(orderId, status, auth, opts?)
client.orders.cancel(orderId, auth, opts?)       // alias: transition(DECLINED)

client.salesOrders.get(orderId, auth)
client.salesOrders.update(orderId, patch, auth, opts?)
```

### saas-token (opt-in)

Some tenants require a `saas-token` header alongside the customer Bearer. Pass it via `opts.saasToken`:

```ts
await client.orders.listMine(ctx, { saasToken: customerSession.saasToken });
```

`useCustomerSession()` exposes the active session's `saasToken`; pass it explicitly to the hook/SDK call when needed (no implicit reach into session state).

## React hooks

```ts
useMyOrders({ pageSize?, status?, legalEntityId?, saasToken? })
useMyOrdersInfinite({ pageSize?, status?, legalEntityId?, saasToken? })
useOrder(orderId, { saasToken? })

useCancelOrder()                    // mutate(orderId | { orderId, saasToken })
useOrderTransition()                // mutate({ orderId, status, comment?, saasToken? })
useReorder()                        // mutate({ orderId, saasToken? }) → { added, errors }

useSalesOrder(orderId, auth)        // disabled when auth is undefined
useUpdateSalesOrder()               // mutate({ orderId, patch, auth, recalculate? })
```

### Active-company defaulting

`useMyOrders` and `useMyOrdersInfinite` read `legalEntityId` from `useActiveCompany()` when the option is undefined. Pass `legalEntityId: null` to disable the auto-default (see all orders regardless of context). Query keys include the effective id, so `setActiveCompany` invalidates the list automatically.

### Reorder partial-success

`useReorder` adds line-items to the active cart via a single `POST /cart/{tenant}/carts/{cartId}/itemsBatch` call (Emporix batch endpoint, cap 200 items). Per-entry HTTP status (2xx = added, 4xx/5xx = failed) feeds the `{ added, errors }` mutation result; partial failures do **not** throw. Surface both numbers in the UI. Orders with more than 200 line-items are not supported by this helper.

## SSR

`prefetchOrder(qc, client, orderId, authCtx, opts?)` writes the same cache key `useOrder(orderId)` reads. Mirrors `prefetchProduct` / `prefetchCart`.

## Out of scope (follow-ups)

- B2B shared-orders (other company members' orders) — Sub-Spec #2.
- Full `/salesorders` list + filter + bulk — Sub-Spec #3.
- Order split (vendor marketplace) — Sub-Spec #4.
- Returns and order events — separate Emporix services, separate specs.
