# ProductService.listVariantChildren — Design

**Date:** 2026-05-29
**Status:** Approved (pending written-spec review)
**Packages:** `@viu/emporix-sdk` (core), `@viu/emporix-sdk-react` (hooks)
**Branch:** `feat/variant-children` (off `main`)

## Goal

Encapsulate the Emporix search query that resolves the VARIANT children of a
PARENT_VARIANT product, so consumers call `client.products.listVariantChildren(parentId)`
instead of hand-building `q=productType:VARIANT parentVariantId:{id}`.

## Background — verified against the Emporix docs

Emporix products carry `productType ∈ { BASIC, PARENT_VARIANT, VARIANT, BUNDLE,
DYNAMIC_VARIANT }`. VARIANT children reference their parent via `parentVariantId`.
Both fields are real and queryable (confirmed in `packages/sdk/specs/product.yml`).

The product list endpoint accepts the standard `q` query parameter. Per Emporix's
"Query Parameter" standard-practices doc, **multiple fields are combined by
separating them with spaces** (implicit AND):

> `q=id:5c33… code:A705121667` — Multiple fields (separated by spaces) can be specified.

So the correct query is:

```
q=productType:VARIANT parentVariantId:{id}
```

The requirement text suggested `productType:VARIANT AND parentVariantId:{id}`, but a
bare `AND` keyword is **not** part of this syntax. (Emporix has a separate
`compoundLogicalQuery:((…) AND (…))` operator for nested OR/AND logic — Product
Service supports it — but it is unnecessary here.) The space-separated form also
matches the existing SDK conventions: `getByCode` builds `code:{code}` and
`searchByIds` builds `id:({ids})`.

Value encoding (spaces, special characters in `parentVariantId`) is handled by the
HTTP client: `request()` does `url.searchParams.set("q", query)`, which
percent-encodes the value; the server decodes it back to the raw query string.

## Public API — `packages/sdk/src/services/product.ts`

```ts
/**
 * Streams the VARIANT children of a PARENT_VARIANT product, page by page.
 * Default pageSize 200.
 */
listVariantChildrenAll(
  parentVariantId: string,
  params?: { pageSize?: number },
  auth?: AuthContext,
): AsyncIterable<Product>;

/**
 * Resolves ALL VARIANT children into a flat array (loads every page). Default
 * pageSize 200. Returns [] when there are no children (never throws).
 */
listVariantChildren(
  parentVariantId: string,
  params?: { pageSize?: number },
  auth?: AuthContext,
): Promise<Product[]>;
```

### Implementation

- Query string built in one place: ``const q = `productType:VARIANT parentVariantId:${parentVariantId}`;``
- `listVariantChildrenAll` returns
  `iterateAll<Product>((pageNumber) => this.search(q, { pageNumber, pageSize }, auth))`
  with `pageSize = params?.pageSize ?? 200`. This reuses the existing `search()`
  method (which already wraps `GET /product/{tenant}/products?q&pageNumber&pageSize`
  into `PaginatedItems<Product>` with the `hasNextPage = items.length === pageSize`
  heuristic) and the existing `iterateAll` pagination driver.
- `listVariantChildren` collects the async iterable into an array (DRY — the array
  method delegates to the streaming method):
  ```ts
  const out: Product[] = [];
  for await (const p of this.listVariantChildrenAll(parentVariantId, params, auth)) out.push(p);
  return out;
  ```
- Default auth `anonymous` (the `ANON` const already in the file), matching every
  other read method.
- Returns the existing `Product` union (`BasicProductWithId | BundleProductWithId |
  ParentVariantProductWithId`). No new types, no client wiring, no new subpath
  export — `ProductService` is already on `EmporixClient` and exported.

### Edge cases

- **No children** → `search` returns `[]` → `hasNextPage` false → iterator yields
  nothing → `listVariantChildren` returns `[]`. No throw.
- **Multi-page** → with `pageSize 200`, 250 children = page 1 (200, `hasNextPage`
  true) + page 2 (50, `hasNextPage` false), aggregated to 250.
- **Encoding** → a `parentVariantId` containing spaces or special characters is
  percent-encoded by `searchParams.set`; the server-side decoded `q` equals
  `productType:VARIANT parentVariantId:<rawId>`.

## React — `packages/react/src/hooks/use-variant-children.ts`

Mirrors the existing product hooks (`useReadAuth` + `useReadSite` + `emporixKey`):

```ts
export function useVariantChildren(
  parentVariantId: string | undefined,
  options?: QueryOpts & { pageSize?: number },
): UseQueryResult<Product[]>;
```

- `const { ctx } = useReadAuth(options?.auth)`; `const { siteCode } = useReadSite()`.
- `queryKey: emporixKey("variant-children", [parentVariantId, { pageSize: options?.pageSize }], { tenant: client.tenant, authKind: ctx.kind, siteCode })`
  — the cache key contains `parentVariantId`.
- `enabled: typeof parentVariantId === "string" && parentVariantId !== ""`
  (mirrors `useProductByCode`).
- `queryFn: () => client.products.listVariantChildren(parentVariantId as string, options?.pageSize !== undefined ? { pageSize: options.pageSize } : {}, ctx)`.
- `staleTime: 60_000` (the shared `PRODUCTS_STALE_TIME`).
- Registered in `packages/react/src/hooks/index.ts` and the package barrel
  `packages/react/src/index.ts` (export `useVariantChildren` + the
  `UseVariantChildrenOptions` type alias for `QueryOpts & { pageSize?: number }`).
- The React tests resolve `@viu/emporix-sdk` to its built `dist/`, so the SDK must
  be rebuilt (`pnpm -F @viu/emporix-sdk build`) after the SDK method lands and
  before the hook tests run.

## Tests

### SDK — `packages/sdk/tests/services/product.test.ts` (Vitest + MSW)

A shared MSW handler for `GET /product/acme/products` reads
`url.searchParams.get("q" | "pageNumber" | "pageSize")` and returns the
appropriate slice. Cases:

- **3 children** → handler returns 3 items on page 1 → `listVariantChildren("parent")`
  resolves length 3.
- **250 children, pageSize 200** → page 1 returns 200, page 2 returns 50 →
  aggregated length 250; assert two requests were made.
- **No children** → handler returns `[]` → resolves `[]` (assert no throw).
- **Encoding** → call with `parentVariantId = "p 1&x"`; assert the decoded `q`
  equals `productType:VARIANT parentVariantId:p 1&x`.

(Use the manual-construction harness from the other `tests/services/*.test.ts`
files: `new ProductService({ tenant, http, tokenProvider, logger })` with a
`DefaultTokenProvider`, `HttpClient`, and `MemoryLogger`. If `product.test.ts`
does not exist yet, create it with that harness.)

### React — `packages/react/tests/use-variant-children.test.tsx`

Mirror `use-products`-style hook tests: storefront credentials (anonymous),
MSW handler for the products endpoint returning 2 variant children, assert
`result.current.data` has length 2 and the expected product ids.

## Docs — `docs/products.md`

Create if absent (no `docs/products.md` exists today; product usage is currently
only in the SDK README). Document `listVariantChildren` / `listVariantChildrenAll`
and the `useVariantChildren` hook with a short example, and note the query is
encapsulated so consumers don't build it themselves. Link it from the SDK README.

## Changeset

`.changeset/variant-children.md` — both packages at **minor**:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add ProductService.listVariantChildren / listVariantChildrenAll and the
useVariantChildren React hook to resolve the VARIANT children of a
PARENT_VARIANT product without hand-building the search query.
```

**Changeset-config prerequisite:** `main` does not yet carry the
`___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange: true`
flag (it lives on the unmerged `feat/availability-service` branch). Without it,
`@viu/emporix-sdk` being a `workspace:^` peer of the React package force-**major**s
both to 3.0.0 via `linked`. So this branch must add the same flag to
`.changeset/config.json` to land the intended `2.0.0 → 2.1.0` minor bump. Verify
with `pnpm changeset status` (must report both at `minor`). If the availability
branch merges first, this becomes a no-op/trivial rebase.

## Out of scope (YAGNI)

- `compoundLogicalQuery` form (not needed for a single AND).
- Filtering by additional fields, sorting, or `DYNAMIC_VARIANT` children
  (the requirement targets VARIANT children of a PARENT_VARIANT).
- Any change to `ProductService.search` / `list` / `listAll` semantics.
