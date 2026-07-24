# Customer-Segment Admin CRUD Facade — Design

- **Date:** 2026-07-24
- **Status:** approved (design)
- **Scope:** `@viu/emporix-sdk` (core). No React hooks (admin/backend surface).

## 1. Motivation

`SegmentService` (`client.segments`) wraps only the storefront `segment_read_own` reads (5 of the customer-segment spec's 30 operations). This design adds the **admin CRUD** (25 operations) across three groups: segment entities, customer assignments, item assignments. The customer-segment spec has no deprecated operations.

## 2. Goals / Non-goals

**Goals**
- Extend `SegmentService` with segment core CRUD, customer-assignment CRUD, and item-assignment CRUD.
- Admin methods default `authCtx: AuthContext = SERVICE` (override allowed) — `segment_manage` scope.
- Alias generated `customer-segment` types.

**Non-goals**
- No change to the existing storefront reads (`list`, `get`, `listItems`, `listSegmentItems`, `getCategoryTree`, `listMy*`) — they stay customer-auth (`segment_read_own`).
- No React hooks.
- No new service/accessor/channel — `client.segments` / channel `"segment"` already exist.

## 3. Decisions (from brainstorming)

- **API shape (Approach A):** segment core CRUD as direct methods on `SegmentService`; `client.segments.customers` and `client.segments.items` sub-resource object literals.
- **Auth:** `authCtx: AuthContext = SERVICE` on every admin method (override allowed). The existing customer-auth reads are untouched.
- **B2B vs B2C customer assignments:** distinct methods — `get`/`assign`/`remove` (B2C, by `customerId`) and `getForEntity`/`assignForEntity`/`removeForEntity` (B2B, by `customerId` + `legalEntityId`).
- **`patch` vs `update`:** separate methods (`patch` = PATCH partial, `update` = PUT full).
- **List reads:** plain arrays.

## 4. Method surface

All methods end with `authCtx: AuthContext = SERVICE`. Base `/customer-segment/{tenant}/segments`.

### Direct on `client.segments` (segment core)
| Method | HTTP | Path |
|---|---|---|
| `create(input, auth?)` | POST | `/segments` |
| `search(query, auth?)` | POST | `/segments/search` |
| `update(id, input, auth?)` | PUT | `/segments/{id}` |
| `patch(id, input, auth?)` | PATCH | `/segments/{id}` |
| `delete(id, auth?)` | DELETE | `/segments/{id}` |
| `match(input, auth?)` | POST | `/segments/match` |
| `bulkCreate(inputs, auth?)` | POST | `/segments/bulk` |
| `bulkUpdate(inputs, auth?)` | PUT | `/segments/bulk` |
| `bulkDelete(body, auth?)` | DELETE | `/segments/bulk` |

### `client.segments.customers`
| Method | HTTP | Path |
|---|---|---|
| `list(segmentId, query?, auth?)` | GET | `.../{segmentId}/customers` |
| `search(segmentId, query, auth?)` | POST | `.../{segmentId}/customers/search` |
| `get(segmentId, customerId, auth?)` | GET | `.../{segmentId}/customers/{customerId}` |
| `assign(segmentId, customerId, input, auth?)` | PUT | `.../{segmentId}/customers/{customerId}` |
| `remove(segmentId, customerId, auth?)` | DELETE | `.../{segmentId}/customers/{customerId}` |
| `getForEntity(segmentId, customerId, legalEntityId, auth?)` | GET | `.../customers/{customerId}/{legalEntityId}` |
| `assignForEntity(segmentId, customerId, legalEntityId, input, auth?)` | PUT | `.../customers/{customerId}/{legalEntityId}` |
| `removeForEntity(segmentId, customerId, legalEntityId, auth?)` | DELETE | `.../customers/{customerId}/{legalEntityId}` |
| `bulkAssign(segmentId, inputs, auth?)` | PUT | `.../{segmentId}/customers/bulk` |
| `bulkRemove(segmentId, body, auth?)` | DELETE | `.../{segmentId}/customers/bulk` |

### `client.segments.items` (`type` = `PRODUCT` | `CATEGORY`)
| Method | HTTP | Path |
|---|---|---|
| `search(segmentId, query, auth?)` | POST | `.../{segmentId}/items/search` |
| `get(segmentId, type, itemId, auth?)` | GET | `.../{segmentId}/items/{type}/{itemId}` |
| `assign(segmentId, type, itemId, input, auth?)` | PUT | `.../{segmentId}/items/{type}/{itemId}` |
| `remove(segmentId, type, itemId, auth?)` | DELETE | `.../{segmentId}/items/{type}/{itemId}` |
| `bulkAssign(segmentId, type, inputs, auth?)` | PUT | `.../{segmentId}/items/{type}/bulk` |
| `bulkRemove(segmentId, type, body, auth?)` | DELETE | `.../{segmentId}/items/{type}/bulk` |

Total: 9 (core) + 10 (customers) + 6 (items) = **25**.

## 5. Types (aliases over `generated/customer-segment`)

- Segment: `SegmentInput`=`SegmentCreation`, `SegmentUpdateInput`=`SegmentUpdate`, `SegmentPatchInput`=`Partial<SegmentUpdate>`, `SegmentSearchQuery`=`SegmentsSearch`, `SegmentMatchInput`=`Match`, `SegmentBulkItem`=`SegmentUpdateBulk`; read `Segment`=`SegmentResponse` (exists).
- Customer assignments: `SegmentCustomerInput`=`CustomerAssignmentUpsert`, `SegmentCustomerBulkInput`=`CustomerAssignmentUpsertBulk`, `SegmentCustomer`=`CustomerAssignmentResponse`.
- Item assignments: `SegmentItemInput`=`ItemAssignmentUpsert`, `SegmentItemBulkInput`=`ItemAssignmentUpsertBulk`; read `SegmentItem`=`ItemAssignmentResponse` (exists).
- Bulk results: `SegmentBulkResult`=`BulkResponse`, `SegmentAssignmentBulkResult`=`BulkAssignmentResponse`.

## 6. Wiring

None — `SegmentService`, `client.segments`, channel `"segment"` already exist. Only add the new public type exports to `packages/sdk/src/index.ts`. (The `SegmentService` constructor takes `(ctx, deps)`; admin methods use only `this.ctx`, so tests stub `deps`.)

## 7. Testing

`vi.fn()`-mocked `http.request` harness (as in `price-admin.test.ts`), constructing `new SegmentService(ctxWith(req), { products: {} as never, categories: {} as never })`: one assertion per method for HTTP method, path, `auth`; `expectTypeOf` for the public aliases; assert `SERVICE` default when `auth` is omitted.

## 8. Risks / open items

- Search-request body shapes and the bulk-delete bodies (`/segments/bulk`, `.../customers/bulk`, `.../items/{type}/bulk` — lists of ids/refs) plus exact create/upsert/patch response shapes are confirmed against `generated/customer-segment` at implementation; the aliases in §5 are the expected names. Runtime is unaffected by an alias tweak (the `request<T>` generic is a cast).
- `patch` body typed `Partial<SegmentUpdate>`; if the spec has a dedicated patch DTO, switch to it.
- List reads treated as plain arrays; wrap with `PaginatedItems<T>` if an endpoint returns a paginated envelope.
