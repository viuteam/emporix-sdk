# Price Admin CRUD Facade — Design

- **Date:** 2026-07-24
- **Status:** approved (design)
- **Scope:** `@viu/emporix-sdk` (core). No React hooks (admin/backend surface).

## 1. Motivation

`PriceService` (`client.prices`) wraps only the storefront price-matching (`match`, `matchByContext`, `matchByContextChunked`) — 2 of the price spec's 30 operations. This design adds the **admin CRUD** (28 operations) across the price service's three nouns: flat `prices`, `priceModels`, and `price-lists` (with nested price-list prices). The price spec has no deprecated operations.

## 2. Goals / Non-goals

**Goals**
- Extend `PriceService` with the full admin CRUD for `prices`, `priceModels`, `price-lists`, and nested price-list prices.
- Default auth `service` with override, matching the existing `match*` methods.
- Alias generated `price` types; never hand-author wire shapes.

**Non-goals**
- No change to the existing `match*` methods.
- No React hooks (admin/backend).
- No new service/accessor/channel — `client.prices` / channel `"price"` already exist.

## 3. Decisions (from brainstorming)

- **API shape (Approach A):** the flat `/prices` CRUD are **direct methods** on `PriceService` (the class's core noun); `priceModels` and `price-lists` are sub-resource object literals (`client.prices.models`, `client.prices.lists`). This avoids an awkward `prices.prices`.
- **Nested price-list prices:** methods on `client.prices.lists` that take `listId` as the first argument (`listPrices`, `addPrice`, …), not a sub-sub-resource.
- **Auth:** `authCtx: AuthContext = SERVICE` on every admin method (override allowed).
- **List reads:** return plain arrays (endpoint body is an array).

## 4. Method surface

All methods end with `authCtx: AuthContext = SERVICE`.

### Direct on `client.prices` (flat `/prices`)
| Method | HTTP | Path |
|---|---|---|
| `create(input, auth?)` | POST | `/prices` |
| `list(query?, auth?)` | GET | `/prices` |
| `get(priceId, auth?)` | GET | `/prices/{priceId}` |
| `upsert(priceId, input, auth?)` | PUT | `/prices/{priceId}` |
| `delete(priceId, auth?)` | DELETE | `/prices/{priceId}` |
| `search(query, auth?)` | POST | `/prices/search` |
| `bulkCreate(inputs, auth?)` | POST | `/prices/bulk` |
| `bulkUpsert(inputs, auth?)` | PUT | `/prices/bulk` |

### `client.prices.models` (`/priceModels`)
| Method | HTTP | Path |
|---|---|---|
| `list(query?, auth?)` | GET | `/priceModels` |
| `create(input, auth?)` | POST | `/priceModels` |
| `get(modelId, auth?)` | GET | `/priceModels/{modelId}` |
| `upsert(modelId, input, auth?)` | PUT | `/priceModels/{modelId}` |
| `delete(modelId, auth?)` | DELETE | `/priceModels/{modelId}` |

### `client.prices.lists` (`/price-lists`)
| Method | HTTP | Path |
|---|---|---|
| `list(query?, auth?)` | GET | `/price-lists` |
| `create(input, auth?)` | POST | `/price-lists` |
| `search(query, auth?)` | POST | `/price-lists/search` |
| `get(listId, auth?)` | GET | `/price-lists/{listId}` |
| `upsert(listId, input, auth?)` | PUT | `/price-lists/{listId}` |
| `delete(listId, auth?)` | DELETE | `/price-lists/{listId}` |
| `listPrices(listId, query?, auth?)` | GET | `/price-lists/{listId}/prices` |
| `addPrice(listId, input, auth?)` | POST | `/price-lists/{listId}/prices` |
| `getPrice(listId, priceId, auth?)` | GET | `/price-lists/{listId}/prices/{priceId}` |
| `upsertPrice(listId, priceId, input, auth?)` | PUT | `/price-lists/{listId}/prices/{priceId}` |
| `deletePrice(listId, priceId, auth?)` | DELETE | `/price-lists/{listId}/prices/{priceId}` |
| `searchPrices(listId, query, auth?)` | POST | `/price-lists/{listId}/prices/search` |
| `bulkCreatePrices(listId, inputs, auth?)` | POST | `/price-lists/{listId}/prices/bulk` |
| `bulkUpsertPrices(listId, inputs, auth?)` | PUT | `/price-lists/{listId}/prices/bulk` |
| `bulkDeletePrices(listId, body, auth?)` | DELETE | `/price-lists/{listId}/prices/bulk` |

Total: 8 (flat) + 5 (models) + 6 (lists) + 9 (nested prices) = **28**.

## 5. Types (aliases over `generated/price`)

- Flat price: `GetPrice` (read), `CreatePrice` (create/upsert body).
- Price models: `PriceModelDefinitionCreation` (create/upsert body), `PriceModelRetrieval` (read).
- Price lists: `PriceListCreation` (create body), `PriceListUpdate` (upsert body), `PriceList` (read).
- Price-list prices: `PriceListPriceCreation` (add body), `PriceListPriceUpdate` (upsert body), `PriceListPrice` (read).
- Bulk: `PriceBulkResponseEntry` (per-entry bulk result; bulk methods return `PriceBulkResponseEntry[]`).
- Public names: `PriceCreateInput`, `Price` (=`GetPrice`), `PriceModelInput`, `PriceModel`, `PriceListInput`, `PriceListUpdateInput`, `PriceList`, `PriceListPriceInput`, `PriceListPriceUpdateInput`, `PriceListPrice`, `PriceBulkResult`. Search-request body types confirmed against generated at implementation.

## 6. Wiring

None required — `PriceService`, `client.prices`, and channel `"price"` already exist. Only add the new public type exports to `packages/sdk/src/index.ts`.

## 7. Testing

`vi.fn()`-mocked `http.request` harness (as in `iam.test.ts` / `session-context.test.ts`): one assertion per method for HTTP method, path, and `auth`; `expectTypeOf` for the public aliases. Also assert the `SERVICE` default is used when `auth` is omitted.

## 8. Risks / open items

- Search-request body shapes (`/prices/search`, `/price-lists/search`, nested search) and the exact create/update response shapes are confirmed against `generated/price` during implementation; the aliases in §5 are the expected names. Runtime is unaffected by an alias tweak (the `request<T>` generic is a cast).
- `bulkDeletePrices` sends a `DELETE …/prices/bulk` with a body (list of price ids/codes) — confirm the body shape at implementation.
- List reads are treated as plain arrays; if an endpoint returns a paginated envelope, wrap with `PaginatedItems<T>` (per the `SchemaService.listSchemas` pattern) at implementation.
