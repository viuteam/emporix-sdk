# order-v2 SalesOrders Admin + Legal-Entity B2B — Design

**Date:** 2026-07-24
**Package:** `@viu/emporix-sdk`
**Services:** `SalesOrdersService` (`client.salesOrders`) + `OrdersService` (`client.orders`)
**Spec source:** `packages/sdk/specs/order-v2.yml` → generated `src/generated/order-v2/types.gen.ts`

## Goal

`SalesOrdersService` today ships only single-resource `get` + `update` (PATCH),
with a docstring noting *"the full admin list + filter surface is deferred to a
follow-up sub-spec."* This is that follow-up: the full salesorders admin surface
(list/search/create/replace/delete, transitions, historical transitions,
calculations, entries, split) plus the two B2B legal-entity-order reads. It
completes coverage of the `salesorders` and `legal-entity-orders` groups of
`order-v2.yml`.

## Scope

Extend the two existing classes in `packages/sdk/src/services/orders.ts` with
flat methods — no new classes, no client wiring change, no constructor change.
New public types are aliases defined in `services/orders.ts` and re-exported
through the `src/orders.ts` barrel (which uses explicit named exports).

~13 methods are added (11 on `SalesOrdersService`, 2 on `OrdersService`).

**Intentionally excluded:**
- `RetrieveSpecificOrders` — a second `GET /salesorders` whose generated
  response is `unknown` (a spec artifact); `list` (`RetrieveTenantOrders`)
  already covers `GET /salesorders` with the full query surface.
- Storefront `POST /orders` (order creation) — owned by the checkout flow.
- The storefront `/orders` transition-list read — out of this coverage row
  (salesorders + legal-entity-orders); can follow later.

### Already covered (unchanged)

`OrdersService`: `listMine`, `get`, `transition`, `cancel`.
`SalesOrdersService`: `get` (GET `/salesorders/{id}`), `update` (**PATCH**
`/salesorders/{id}`, body `Partial<OrderUpdateDto>`).

## Auth model

- **`SalesOrdersService` (backend/admin):** every new method takes a **required**
  `auth: AuthContext` (no default), matching the existing `get`/`update` on the
  same class (documented as service-token backend access;
  `order.order_read`/`order.order_manage`).
- **`OrdersService` legal-entity reads (storefront-B2B):** required
  `auth: AuthContext` (customer), matching the existing customer-facing
  `listMine`/`get`.

The generated `GET /salesorders/{id}` (`RetrieveOrderEmployee`) actually
responds `SalesOrder`; the existing `get` hand-types it as `Order` — a
harmless pre-existing mistype left untouched. New methods use the accurate
`SalesOrder` type.

## API surface

### `SalesOrdersService` (required `auth`)

| Method | HTTP | Returns |
|---|---|---|
| `list(auth, opts?)` | GET `/salesorders` | `PaginatedItems<SalesOrder>` |
| `search(query, auth)` | POST `/salesorders/search` (body `SearchRequest`) | `SalesOrder[]` |
| `create(input, auth)` | POST `/salesorders` (body `SalesOrderCreationDto`) | `SalesOrderCreated` (201) |
| `replace(orderId, input, auth)` | PUT `/salesorders/{orderId}` (body `OrderUpdateDto`, 204) → re-fetch | `SalesOrder` |
| `delete(orderId, auth)` | DELETE `/salesorders/{orderId}` | `void` (204) |
| `listTransitions(orderId, auth)` | GET `/salesorders/{orderId}/transitions` | `Transition[]` |
| `transition(orderId, input, auth)` | POST `/salesorders/{orderId}/transitions` (body `Transition`, 204) | `void` |
| `listHistoricalTransitions(orderId, auth)` | GET `/salesorders/{orderId}/historical-transitions` | `SalesOrderHistoricalTransitions` |
| `calculate(orderId, input, auth)` | POST `/salesorders/{orderId}/calculations` (body `OrderCalculationDto`) | `unknown` |
| `updateEntries(orderId, input, auth)` | POST `/salesorders/{orderId}/entries` (body `OrderEntriesDto`) | `SalesOrder` |
| `split(orderId, input, auth)` | POST `/salesorders/{orderId}/split` (body `OrderSplitRequest`) | `SalesOrderSplitResult` |

Details:

- `list` `opts`: `pageNumber?`, `pageSize?`, `sort?`, `fields?`, `q?`
  (`QueryFor<"ORDER">`, resolved with `compoundLogicalQuery: false`). Response
  is a bare `SalesOrder[]` (total lives in `X-Total-Count`) wrapped into
  `PaginatedItems` — mirroring `OrdersService.listMine`.
- `search` sends a `SearchRequest` body and returns the bare `SalesOrder[]`.
- `create` returns the generated `ResourceLocation` (a `{ id?, … }` envelope) —
  201 has no full order body.
- `replace` (PUT) is a full replace; the endpoint returns 204, so it re-fetches
  via a **direct** `GET /salesorders/{orderId}` typed as `SalesOrder` (the
  existing `get` returns the mistyped `Order`) and returns the updated
  `SalesOrder`. The existing `update` (PATCH, partial) is unchanged; docstrings
  state `update` = PATCH, `replace` = PUT.
- `calculate` returns `unknown` (the generated 200 response is `unknown`).
- `transition` posts a `Transition` body; `listTransitions` returns
  `Transition[]`; `listHistoricalTransitions` returns the
  `HistoricalTransitionsResponse` envelope.

### `OrdersService` legal-entity reads (required `auth`, customer)

| Method | HTTP | Returns |
|---|---|---|
| `listForLegalEntity(legalEntityId, auth, opts?)` | GET `/legal-entity-orders/{legalEntityId}` | `PaginatedItems<SalesOrder>` |
| `getForLegalEntity(legalEntityId, orderId, auth)` | GET `/legal-entity-orders/{legalEntityId}/{orderId}` | `SalesOrder` |

`listForLegalEntity` `opts`: `pageNumber?`, `pageSize?`, `sort?`, `q?`
(same `q` handling as `listMine`). Response wrapped into `PaginatedItems`.

### Public types (alias → generated)

Already public (from the barrel, direct generated re-exports): `SalesOrder`,
`Transition`, `Order`, `OrderEntry`, `OrderStatus`.

New aliases in `services/orders.ts` (re-exported via `src/orders.ts`):

| Public alias | Generated type |
|---|---|
| `SalesOrderCreateInput` | `SalesOrderCreationDto` |
| `SalesOrderCreated` | `ResourceLocation` |
| `SalesOrderReplaceInput` | `OrderUpdateDto` |
| `SalesOrderSearchInput` | `SearchRequest` |
| `SalesOrderHistoricalTransitions` | `HistoricalTransitionsResponse` |
| `SalesOrderCalculationInput` | `OrderCalculationDto` |
| `SalesOrderEntriesInput` | `OrderEntriesDto` |
| `SalesOrderSplitInput` | `OrderSplitRequest` |
| `SalesOrderSplitResult` | `OrderSplitResponse` |

Plus option interfaces `ListSalesOrdersOptions` and
`ListLegalEntityOrdersOptions`. The existing `SalesOrderPatch`
(`Partial<OrderUpdateDto>`) is unchanged.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy.

## Testing

New unit test `packages/sdk/tests/services/orders-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`segment-admin.test.ts`.

- **SalesOrders block:** each method hits the right method + path with the
  required `auth` forwarded; `list` wraps into `PaginatedItems`; `replace` PUTs
  then re-fetches (two calls: PUT then GET) and returns the fetched
  `SalesOrder`; `create` returns the `ResourceLocation`.
- **Legal-entity block:** `listForLegalEntity` GETs
  `/legal-entity-orders/{leId}` (wrapped); `getForLegalEntity` GETs
  `/legal-entity-orders/{leId}/{orderId}`.

## Release

Changeset `.changeset/order-v2-salesorders-legal-entity.md`, `@viu/emporix-sdk`
**minor** (additive: new methods + types, no change to existing behavior).

## Out of scope

- React hooks (backend/admin salesorders ops are not storefront-facing; the
  legal-entity B2B reads can get hooks in a later storefront pass if needed).
- Live tenant verification (pure facade + unit tests, as with the prior admin
  PRs).
