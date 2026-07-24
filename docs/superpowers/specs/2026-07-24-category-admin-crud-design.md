# Category Admin CRUD — Design

**Date:** 2026-07-24
**Package:** `@viu/emporix-sdk`
**Service:** `CategoryService` (`client.categories`)
**Spec source:** `packages/sdk/specs/category.yml` → generated `src/generated/category/types.gen.ts`

## Goal

The Category service currently exposes storefront reads plus one write
(`rebuildTree`). The write-CRUD surface and the assignment management are
missing. This work closes that gap: full category CRUD, category ↔ resource
assignments, and the two remaining search reads — bringing the service to
complete coverage of `category.yml` (minus one deprecated endpoint).

## Scope

Extend the existing `CategoryService` class in place. No new class, no client
wiring change (the service is already registered in `client.ts` / `index.ts`),
no constructor change (single `ctx` argument, no dependencies).

16 operations are added. The deprecated `GET /categories/categoryTree`
(`GetCategoryTreeRetrieveCategoryTreeDeprecated`) is intentionally **excluded** —
the non-deprecated `tree()` and `getTree()` already cover category-tree reads.

### Already covered (unchanged)

`get`, `list`, `search` (GET + `q`), `listAll`, `tree`, `getTree`, `parents`,
`childCategories`, `subcategories`, `productsIn`, `searchByIds` (internal),
`rebuildTree`.

## Auth model

- **Writes** default to `SERVICE` auth (`const SERVICE: AuthContext = { kind: "service" }`,
  already present), always overridable via a trailing `auth` argument.
- **New reads** default to `ANON` (matching the existing reads), overridable.
- `publish` writes require the `category.category_publish` /
  `category.category_unpublish` scopes on the supplied token; reading unpublished
  categories requires `category.category_read_unpublished`. These are enforced
  server-side — the SDK only forwards the token and query flags.

## API surface

### 1 — Core CRUD (direct methods on `CategoryService`)

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `create(input, options?, auth?)` | POST `/categories` | SERVICE | `CategoryCreated` (201) |
| `update(categoryId, input, options?, auth?)` | PUT `/categories/{categoryId}` | SERVICE | `CategoryCreated \| void` (201 upsert-create / 204 update) |
| `patch(categoryId, input, options?, auth?)` | PATCH `/categories/{categoryId}` | SERVICE | `void` (204) |
| `delete(categoryId, auth?)` | DELETE `/categories/{categoryId}` | SERVICE | `void` (204) |

`options = { publish?: boolean }` → sets the `publish` query parameter. `PUT`
is an upsert: with a caller-supplied id it may create (201, returns the id) or
update (204, no body).

### 2 — Search reads

| Method | HTTP | Auth | Notes |
|---|---|---|---|
| `searchByQuery(query, params?, auth?)` | POST `/categories/search` | ANON | Body `{ q }` via `resolveQuery(query, { compoundLogicalQuery: false })` — same query capability as the GET-based `search()`; the difference is the POST-body transport, which avoids URL-length limits for large `q` filters (e.g. long id lists). `params`: `pageNumber`, `pageSize`, `sort`, `showRoots`, `showUnpublished`. Returns `PaginatedItems<Category>`. |
| `searchTrees(input, options?, auth?)` | POST `/category-trees/search` | ANON | Body `{ categoryIds }` (`CategoryTreeSearchInput`). `options = { showUnpublished?: boolean }`. Returns `CategoryNode[]`. |

`searchByQuery` complements — does not replace — the existing GET `search()`.
Both apply `compoundLogicalQuery: false` (Category does not support compound
`or()` filters); the POST variant only changes the transport. `showRoots` /
`showUnpublished` are POST-specific query flags not available on the GET path.

### 3 — Assignments sub-resource (`client.categories.assignments`)

A `readonly assignments = { ... }` object literal on the service (arrow
functions capture `this.ctx`), mirroring the segment/price sub-resource pattern.

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `list(categoryId, params?, auth?)` | GET `/categories/{categoryId}/assignments` | ANON | `CategoryAssignment[]` (200) |
| `create(categoryId, input, auth?)` | POST `/categories/{categoryId}/assignments` | SERVICE | `CategoryAssignmentCreated` (201) |
| `bulkCreate(categoryId, input, auth?)` | POST `…/assignments/bulk` | SERVICE | `CategoryAssignmentBulkResult` (207) |
| `remove(categoryId, assignmentId, auth?)` | DELETE `…/assignments/{assignmentId}` | SERVICE | `void` (204) |
| `removeAll(categoryId, options?, auth?)` | DELETE `…/assignments` | SERVICE | `void` (204) |
| `upsertByReference(categoryId, referenceId, auth?)` | PUT `…/assignments/references/{referenceId}` | SERVICE | `CategoryAssignmentCreated` (201/204) |
| `removeByReference(categoryId, referenceId, auth?)` | DELETE `…/assignments/references/{referenceId}` | SERVICE | `void` (204) |
| `bulkUpsertByReference(categoryId, input, auth?)` | PUT `…/assignments/references/bulk` | SERVICE | `CategoryAssignmentBulkResult` (207) |
| `listCategoriesByReference(referenceId, params?, auth?)` | GET `/assignments/references/{referenceId}` | ANON | `Category[]` (200) — **tenant-wide**, not category-bound |
| `removeAllByReference(referenceId, auth?)` | DELETE `/assignments/references/{referenceId}` | SERVICE | `void` (204) — **tenant-wide** |

Details:

- `list` params: `pageNumber`, `pageSize`, `sort`, `expandSupercategoriesIds`,
  `showUnpublished`.
- `removeAll` `options = { assignmentType?: "PRODUCT" }` → query filter.
- `upsertByReference` takes **no body** — only the path `referenceId`.
- `listCategoriesByReference` params: `pageNumber`, `pageSize`, `sort`,
  `showUnpublished`, `expandSupercategoriesIds`.
- The last two methods operate on `/category/{tenant}/assignments/...` (no
  `/categories/{id}` segment) — a tenant-level reference lookup/delete across
  all categories.

#### Assignment reference type

The generated schema locks the assignment `ref.type` to `'PRODUCT'` only.
Category-to-category hierarchy in Emporix is managed via `parentId` on the
category (`create`/`update`), **not** via assignments. The write inputs
therefore stay strictly `'PRODUCT'` per the generated types (no invented
`CATEGORY` capability); docstrings state this. (The existing `subcategories()`
read still tolerates `CATEGORY` refs that the API may return — that read is
unchanged and separate.)

### 4 — Public types (alias → generated)

| Public alias | Generated type |
|---|---|
| `CategoryCreateInput` | `CategoryCreateRequest` |
| `CategoryUpdateInput` | `CategoryUpdateRequest` |
| `CategoryPatchInput` | `CategoryPartialUpdateRequest` |
| `CategoryCreated` | `CategoryIdResponse` |
| `CategoryAssignment` | `CategoryAssignment` |
| `CategoryAssignmentInput` | `AssignmentRequest` |
| `CategoryAssignmentBulkInput` | `BulkAssignmentRequest` |
| `CategoryAssignmentRefBulkInput` | `BulkAssignmentUpsertRequest` |
| `CategoryAssignmentBulkResult` | `BulkAssignmentResponse` |
| `CategoryAssignmentCreated` | `AssignmentIdResponse` |
| `CategoryTreeSearchInput` | `CategoryTreeSearchRequest` |

All exported from `packages/sdk/src/index.ts` alongside the existing
`Category` / `CategoryNode`.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy (400 → validation, 403 → forbidden, 404 → not-found,
409 → conflict on duplicate ECN). Methods surface those as-is.

## Testing

New unit test `packages/sdk/tests/services/category-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`segment-admin.test.ts`. No MSW, no token provider — these are pure
path/method/auth assertions.

- **Core CRUD block:** `create`/`update`/`patch`/`delete` hit the right
  method + path with the `SERVICE` default; the `publish` option maps to the
  query; an explicit `auth` override is honored.
- **Search block:** `searchByQuery` POSTs `/categories/search` with a resolved
  `q` body and `ANON` default; `searchTrees` POSTs `/category-trees/search`.
- **Assignments block:** each `assignments.*` method hits the right
  method + path; `upsertByReference` sends no body; the two tenant-level
  reference ops target `/assignments/references/{referenceId}`.

## Release

Changeset `.changeset/category-admin-crud.md`, `@viu/emporix-sdk` **minor**
(additive: new methods + types, no breaking change to existing reads).

## Out of scope

- React hooks for the new admin operations (admin CRUD is server-side; the
  React bindings stay storefront-focused, consistent with prior admin PRs).
- The deprecated `GET /categories/categoryTree` endpoint.
- Any live tenant verification (pure facade + unit tests, as with the
  price/segment admin PRs).
