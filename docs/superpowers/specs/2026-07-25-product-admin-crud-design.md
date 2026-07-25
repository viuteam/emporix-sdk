# Product Admin CRUD — Design

**Date:** 2026-07-25
**Package:** `@viu/emporix-sdk`
**Service:** `ProductService` (`client.products`)
**Spec source:** `packages/sdk/specs/product.yml` → generated `src/generated/product/types.gen.ts`

## Goal

`ProductService` today wraps only the catalog reads (get/getByCode/list/search/
variant children). The entire write surface is missing: product CRUD, bulk
create/update, the dynamic-variant recalculation group, and product templates.
This work closes that gap — 12 operations — completing coverage of the 17
operations in `product.yml`.

## Scope

Extend the existing `ProductService` class in place: flat methods for products
plus a `readonly templates = {…}` sub-resource. No new class, no client wiring
change, no constructor change.

### Already covered (unchanged)

`get`, `getByCode`, `list`, `listAll`, `search`, `searchByName`, `searchByIds`,
`searchByCodes`, `listVariantChildren`, `listVariantChildrenAll`.

## Auth model

- **Writes** default to `SERVICE` auth — a new `const SERVICE: AuthContext = { kind: "service" }`
  next to the existing `ANON`. Always overridable via the trailing `auth` argument.
- **New reads** (recalculation jobs, template reads) default to `ANON`, matching
  the existing reads.

## Boolean query flags

The product write endpoints take boolean query flags. The SDK's `query` type is
`Record<string, string | number | undefined>` — it does **not** accept booleans —
so every flag is serialized with `String(...)` (the convention used in
`segment.ts` and `category.ts`). Each method exposes exactly the flags its
endpoint declares:

| Method | Flags |
|---|---|
| `create`, `update`, `bulkCreate`, `bulkUpdate` | `skipVariantGeneration?`, `doIndex?`, `skipRelatedItemsValidation?` |
| `replace` | `partial?`, `skipVariantGeneration?`, `doIndex?`, `skipRelatedItemsValidation?` |
| `delete` | `force?`, `doIndex?` |

## API surface

### 1 — Product write CRUD (direct methods)

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `create(input, options?, auth?)` | POST `/products` | SERVICE | `ProductCreated` (201) |
| `update(productId, input, options?, auth?)` | PATCH `/products/{productId}` | SERVICE | `void` (204) |
| `replace(productId, input, options?, auth?)` | PUT `/products/{productId}` | SERVICE | `ProductCreated \| void` (201 create / 204 update) |
| `delete(productId, options?, auth?)` | DELETE `/products/{productId}` | SERVICE | `void` (204) |

Naming follows the convention established in category (#166) and order-v2
(#168): `update` is the **PATCH** (partial), `replace` is the **PUT** (full).
The PUT additionally accepts a `partial` flag; that is surfaced through
`replace`'s options rather than as a second method.

### 2 — Bulk

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `bulkCreate(input, options?, auth?)` | POST `/products/bulk` | SERVICE | `ProductBulkResult[]` (207) |
| `bulkUpdate(input, options?, auth?)` | PUT `/products/bulk` | SERVICE | `ProductBulkResult[]` (207) |

Both respond 207 Multi-Status: partial failures do **not** throw — inspect each
entry's status. Bodies are the generated arrays (`ProductBulkCreateBody` /
`ProductBulkUpdateBody`).

### 3 — Dynamic-variant recalculation

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `recalculate(input, auth?)` | POST `/products/recalculate` | SERVICE | `ProductRecalculationResult` (202) |
| `listRecalculationJobs(params?, auth?)` | GET `/products/recalculate/jobs` | ANON | `ProductRecalculationJob[]` (200) |
| `getRecalculationJob(jobId, auth?)` | GET `/products/recalculate/jobs/{jobId}` | ANON | `ProductRecalculationJob` (200) |

- `recalculate` body is `{ productIds: string[] }`. The 202 response carries
  `jobs` (created or already-referenced jobs) and `skippedProductIds` — products
  skipped because a recalculation for their root is already PENDING/PROCESSING.
- `listRecalculationJobs` `params`: `{ status?: DynamicVariantRecalculationJobStatus }`
  (the only query parameter the endpoint declares).

### 4 — `products.templates` sub-resource

A `readonly templates = { … }` object literal of arrow functions (capturing
`this.ctx`), matching the sub-resource pattern in `segment.ts` / `category.ts`.

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `list(params?, auth?)` | GET `/product-templates` | ANON | `ProductTemplate[]` (200) |
| `get(templateId, auth?)` | GET `/product-templates/{templateId}` | ANON | `ProductTemplate` (200) |
| `create(input, auth?)` | POST `/product-templates` | SERVICE | `ProductTemplateCreated` (201) |
| `update(templateId, input, auth?)` | PUT `/product-templates/{templateId}` | SERVICE | `void` (204) |
| `delete(templateId, auth?)` | DELETE `/product-templates/{templateId}` | SERVICE | `void` (204) |

- `list` `params`: `pageNumber?`, `pageSize?`, `sort?`, `q?` (raw string — the
  template endpoint's `q` is a plain query parameter; no `QueryFor` entity
  exists for templates).
- The generated path parameter is named `product-template-id` (kebab-case). That
  only affects path interpolation, not the method signature.
- The 201 create response is an inline `{ id?: string }` — aliased as
  `ProductTemplateCreated` for a stable public name.

### 5 — Public types (alias → generated)

| Public alias | Generated type |
|---|---|
| `ProductCreateInput` | `ProductCreateBody` |
| `ProductUpdateInput` | `ProductUpdateBody` |
| `ProductPatchInput` | `ProductPartialUpdateBody` |
| `ProductCreated` | `ResourceLocation` |
| `ProductBulkCreateInput` | `ProductBulkCreateBody` |
| `ProductBulkUpdateInput` | `ProductBulkUpdateBody` |
| `ProductBulkResult` | `BulkResponse` |
| `ProductRecalculationInput` | `DynamicVariantRecalculationRequest` |
| `ProductRecalculationResult` | `DynamicVariantRecalculationResponse` |
| `ProductRecalculationJob` | `DynamicVariantRecalculationJobResponse` |
| `ProductRecalculationJobStatus` | `DynamicVariantRecalculationJobStatus` |
| `ProductTemplate` | `ProductTemplateResponse` |
| `ProductTemplateCreateInput` | `ProductTemplateCreation` |
| `ProductTemplateUpdateInput` | `ProductTemplateUpdate` |
| `ProductTemplateCreated` | inline `{ id?: string }` (declared in `product.ts`) |

All exported from `packages/sdk/src/index.ts` alongside the existing `Product` /
`Media`.

**Pre-existing narrowing, left untouched:** the public `Product` type unions only
3 of the 5 generated product shapes (`BasicProductWithId`, `BundleProductWithId`,
`ParentVariantProductWithId` — missing `VariantProductWithId` and
`DynamicVariantProductWithId`). The new write inputs use the full generated
unions (all 5 shapes), so creating a variant or dynamic-variant product is
possible even though reads still type as the narrower union. Widening the read
union is a separate, potentially breaking change and is out of scope.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy (400 validation, 403 forbidden, 404 not-found, 409
conflict). The 207 bulk responses are returned as-is (not thrown).

## Testing

New unit test `packages/sdk/tests/services/product-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`category-admin.test.ts`.

- **CRUD block:** `create`/`update`/`replace`/`delete` hit the right
  method + path with the `SERVICE` default; the option flags map to
  stringified query values (e.g. `{ doIndex: true }` → `query: { doIndex: "true" }`,
  `delete` with `{ force: true }` → `query: { force: "true" }`); an explicit
  `auth` override is honored.
- **Bulk + recalculation block:** `bulkCreate` POSTs `/products/bulk`,
  `bulkUpdate` PUTs it; `recalculate` POSTs `/products/recalculate` with the
  `productIds` body; `listRecalculationJobs` GETs the jobs path and forwards a
  `status` filter with `ANON` default; `getRecalculationJob` GETs
  `…/jobs/{jobId}`.
- **Templates block:** each `templates.*` method hits the right method + path;
  reads default to `ANON`, writes to `SERVICE`; `list` forwards paging/`q`.

## Release

Changeset `.changeset/product-admin-crud.md`, `@viu/emporix-sdk` **minor**
(additive: new methods + types, no change to existing reads).

## Out of scope

- React hooks (admin writes are server-side; the React bindings stay
  storefront-focused, consistent with prior admin PRs).
- Widening the public `Product` read union to all 5 generated shapes.
- Live tenant verification (pure facade + unit tests, as with the prior admin
  PRs).
