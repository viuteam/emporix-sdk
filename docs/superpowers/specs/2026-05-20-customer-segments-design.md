# Customer Segment Service (storefront reads) — Design

**Date:** 2026-05-20
**Status:** Approved (design)

## Goal

Add first-class SDK support for Emporix's **Customer Segment Service** so a
storefront can read everything a logged-in customer's segments give them
access to: the segments themselves, the items (products + categories)
assigned to those segments, the segment-aware category tree, and the
**hydrated** product/category objects.

## Decisions (locked with the user)

| # | Decision |
|---|----------|
| 1 | Storefront reads only (`customersegment.segment_read_own`). Admin CRUD/assignments out of scope (YAGNI). |
| 2 | Cross-service **hydrate helpers** (`listMyProducts` / `listMyCategories`) that go from segment-item IDs to real Product/Category objects. |
| 3 | React: three lightweight hooks — `useMySegments`, `useMySegmentItems`, `useMySegmentCategoryTree`. |
| 4 | `SegmentService` takes auxiliary services (`ProductService`, `CategoryService`) via **constructor injection** at `EmporixClient` build time. No `ClientContext` extension. |
| 5 | All Segment methods require a customer/raw `AuthContext` (`requireCustomer` guard). Anonymous tokens are rejected at the SDK boundary. |

## Validated Emporix API facts

Sources: developer.emporix.io, MCP-verified.

- **Service base:** `/customer-segment/{tenant}/`.
- **Raw spec:**
  `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/companies-and-customers/customer-segments/api-reference/api.yml`
  (folder is `customer-segments`, plural — verified live).
- **Storefront read scope:** `customersegment.segment_read_own` (carried by
  standard customer tokens). Falls back to `segment_read` if granted.
- **Segments are static lists.** Each segment carries two assignment
  collections: **customers** (membership) and **items** (PRODUCT/CATEGORY
  references). No rules engine.
- **Read endpoints in scope:**
  - `GET /customer-segment/{tenant}/segments` — list segments; with
    `segment_read_own` returns only the caller's segments.
  - `GET /customer-segment/{tenant}/segments/{segmentId}` — single segment.
  - `GET /customer-segment/{tenant}/segments/items?q&siteCode&legalEntityId&onlyActive`
    — items across **all** the caller's active segments.
  - `GET /customer-segment/{tenant}/segments/{segmentId}/items?q&legalEntityId`
    — items of one segment.
  - `GET /customer-segment/{tenant}/segments/items/category-trees?siteCode&legalEntityId`
    — category tree filtered to the caller's segments.
- **Critical platform property:** the standard product/category endpoints
  do **NOT** auto-filter by the customer's segment from the bearer token.
  The storefront is expected to call the segment service to discover IDs
  and then fetch real product/category objects itself. The SDK's hydrate
  helpers wrap that two-phase pattern.
- **`customer-group` ≠ `customer-segment`.** Different concepts: price
  lists key off **groups**; segments scope products/categories/coupons.
  No overlap in this design.

## Architecture

### A. Codegen + auth

- `scripts/fetch-specs.ts` adds `customer-segment` → vendored at
  `packages/sdk/specs/customer-segment.yml`; generated into
  `packages/sdk/src/generated/customer-segment/`.
- Bindings doc `plan-customer-segments-type-bindings.md` records the exact
  generated symbols (the `Segment` shape, the `SegmentItem` shape, the
  category-tree node shape, the items-list response shape) — same accepted
  pattern as Plans A/B/D and Media.
- Auth: `requireCustomer(auth)` (existing helper in `customer.ts` — reuse
  via a local copy or by extracting; the plan extracts it to a tiny shared
  helper to avoid the `customer.ts` ↔ `segment.ts` import cycle). Caller
  must pass `auth.customer(token)` or `auth.raw(token)`.

### B. `SegmentService`

New `packages/sdk/src/services/segment.ts`. Constructor takes the standard
`ClientContext` **plus** the dependent services via DI:

```ts
export interface SegmentServiceDeps {
  products: ProductService;
  categories: CategoryService;
}

export class SegmentService {
  constructor(private readonly ctx: ClientContext, private readonly deps: SegmentServiceDeps) {}
  // …
}
```

Public methods (default auth: none — `requireCustomer` enforced):

```ts
list(query?: { q?: string; pageNumber?: number; pageSize?: number }, auth?: AuthContext): Promise<Segment[]>
get(segmentId: string, auth?: AuthContext): Promise<Segment>

listItems(
  query?: { q?: string; siteCode?: string; legalEntityId?: string; onlyActive?: boolean },
  auth?: AuthContext,
): Promise<SegmentItem[]>

listSegmentItems(
  segmentId: string,
  query?: { q?: string; legalEntityId?: string; pageNumber?: number; pageSize?: number },
  auth?: AuthContext,
): Promise<SegmentItem[]>

getCategoryTree(
  query?: { siteCode?: string; legalEntityId?: string },
  auth?: AuthContext,
): Promise<CategoryTreeNode[]>
```

### C. Hydrate helpers

```ts
listMyProductIds(query?, auth?): Promise<string[]>
listMyCategoryIds(query?, auth?): Promise<string[]>

// Hydrate sugar — parallel `products.get(id)` / `categories.get(id)` via
// the injected services. YAGNI on bulk fetch; documented in JSDoc.
listMyProducts(query?, auth?): Promise<Product[]>
listMyCategories(query?, auth?): Promise<Category[]>
```

`listMyProductIds` filters `listItems` by `type === "PRODUCT"` and pulls
the assignment's product id; `listMyCategoryIds` does the same for
`CATEGORY`. The hydrate methods then call `Promise.all(ids.map(...))` on
the injected services. Each helper accepts the same `query` shape as
`listItems` (so the caller can scope by `siteCode`/`legalEntityId`) and
the same `auth` last arg.

### D. `EmporixClient` wiring

In `packages/sdk/src/client.ts`, after `this.media = new MediaService(...)`:

```ts
this.segments = new SegmentService(mk("segment"), {
  products: this.products,
  categories: this.categories,
});
```

`readonly segments: SegmentService;` on the class. `ServiceName` in
`logger.ts` gains `"segment"`. Subpath export `./segment`. `commitlint`
scope `segment`. `index.ts` re-exports `SegmentService` + public types.

### E. React hooks

Three lightweight read-only hooks under
`packages/react/src/hooks/use-my-segments.ts`:

```ts
useMySegments(query?: { q?: string; pageNumber?: number; pageSize?: number })
useMySegmentItems(query?: { q?: string; siteCode?: string; legalEntityId?: string; onlyActive?: boolean })
useMySegmentCategoryTree(query?: { siteCode?: string; legalEntityId?: string })
```

- Use the stored customer token via `useEmporix().storage.getCustomerToken()`.
- `enabled: token !== null` — no fetch when logged out (no anonymous
  fallback because the scope is `segment_read_own`).
- `queryKey` shape: `["emporix", "segment", <method>, { tenant, query, anon: false }]`
  — same pattern as `useMatchPrices` so cache isolation per customer
  session works correctly.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `SegmentService` (core reads) | List/get segments, list items, category tree | `http`, `auth` |
| `SegmentService` hydrate helpers | Map IDs → real Product/Category objects | `products`, `categories` (DI) |
| `requireCustomer` guard (extracted) | Enforce customer/raw auth | — |
| React hooks | Bind storage customer-token to the service | react-query, sdk |

The hydrate helpers are intentionally on `SegmentService` (not free
functions) so consumers stay in the `client.segments.*` namespace; the DI
through the constructor is the explicit, type-checked cross-service edge.

## Error handling

- `requireCustomer(auth)` throws `EmporixAuthError` synchronously when an
  anonymous or service token is passed.
- `HttpClient`'s existing typed-error mapping passes 4xx/5xx from
  `/customer-segment/...` through verbatim (`EmporixAuthError` on 401,
  `EmporixForbiddenError` on 403, etc.).
- Hydrate helpers: if **any** individual `products.get(id)` /
  `categories.get(id)` rejects, the `Promise.all` rejects — the caller
  sees one failure for the whole batch. This is acceptable for the
  YAGNI/parallel-get baseline; an `allSettled`-based partial-success
  variant is **out of scope** (can be added later under a different
  method name if needed).

## Testing

- **SDK (msw):**
  - `list`/`get` — customer Bearer, query passthrough, generated return
    type; anonymous auth → `EmporixAuthError`.
  - `listItems` — `siteCode`/`legalEntityId`/`onlyActive`/`q` params sent
    when provided, omitted when absent.
  - `listSegmentItems` — path param + pagination.
  - `getCategoryTree` — params + return type.
  - `listMyProductIds`/`listMyCategoryIds` — type filter applied; correct
    id list returned.
  - `listMyProducts`/`listMyCategories` — N parallel calls to `products.get`/
    `categories.get`; joined order preserved; rejection of any sub-call
    rejects the whole `Promise.all`.
- **React (jsdom):**
  - All three hooks: data returned with a customer token in storage;
    `enabled === false` when storage has no customer token (no network
    call); error path propagates.
- Coverage ≥80% on `packages/*` maintained.

## Release / docs

- Changeset: `@viu/emporix-sdk` **minor** (new service + new subpath +
  generated types), `@viu/emporix-sdk-react` **minor** (three new hooks).
  Additive — no breaking changes.
- New doc `docs/segments.md`:
  - Auth model: customer-token only (`segment_read_own`); SDK rejects
    anonymous at the boundary.
  - Storefront flow: segment items → hydrate via `products`/`categories`.
  - Segment-aware category tree as the navigation primitive.
  - **Customer-group ≠ customer-segment** clarification (one-paragraph
    note linking to `docs/auth.md` for the group / price-list mechanics).
  - YAGNI/out-of-scope: admin CRUD, customer-assignment writes,
    item-assignment writes, partial-success hydrate.

## Plan decomposition

Cohesive enough for **one spec**; execution as **one phased plan**, branch
`feat/customer-segments` from `main`:

1. Vendor + generate the customer-segments spec; bindings doc.
2. `SegmentService` core reads (`list`/`get`/`listItems`/`listSegmentItems`/
   `getCategoryTree`) + `requireCustomer` extraction + client wiring +
   `./segment` subpath + commitlint scope + tests.
3. Hydrate helpers (`listMyProductIds`/`listMyCategoryIds`/`listMyProducts`/
   `listMyCategories`) + auxiliary-service constructor injection + tests.
4. React hooks (3) + tests.
5. `docs/segments.md` + changeset + green gate + finish.

## Out of scope (YAGNI)

- Admin CRUD for segments (`POST/PUT/PATCH/DELETE /segments`).
- Customer-assignment writes (assign/remove customers to/from a segment).
- Item-assignment writes (assign/remove products/categories).
- The `customer-group` concept (orthogonal — handled by Price Service and
  customer profile, not relevant here).
- Bulk product-fetch optimization (a single `?q=id:(p1,p2,…)` round-trip)
  — only if the parallel-get baseline becomes a measurable bottleneck.
- Partial-success hydrate (`Promise.allSettled` variant).
