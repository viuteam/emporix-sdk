# products.searchByCodes — Design

- **Date:** 2026-05-29
- **Status:** Approved (design); pending implementation plan
- **Packages:** `@viu/emporix-sdk` + `@viu/emporix-sdk-react`
- **Branch:** `feat/products-search-by-codes`

## 1. Context & motivation

`client.products.searchByIds(ids)` bulk-fetches products via
`POST /product/{tenant}/products/search` with `q="id:(id1,id2,…)"`, chunking at
100. There is no code-based equivalent, so consumers either fire N parallel
`getByCode` calls or hand-build the query syntax. This adds a parallel
`searchByCodes(codes)` plus a React hook.

### Verified facts (from the existing code + Emporix q-param spec)
- `searchByIds` (product.ts) does **no escaping** and **no dedup** — it joins
  ids directly into `id:(…)`, assuming ids are delimiter-safe. Default auth
  `ANON`. Empty input → `[]`. Returns `pages.flat()` (order not guaranteed).
- Emporix `q` IN-list syntax is comma-separated: `q=code:(a,b)`. Double-quoted
  values (`code:("apple","onion")`) are documented **only** inside the
  `compoundLogicalQuery` operator — plain quoted IN-lists are not confirmed.
  Therefore quoting is **not** used here.
- There is **no `useProductsByIds` hook** in `@viu/emporix-sdk-react`. Existing
  product hooks (`useProduct`, `useProductByCode`, `useProductSearch`) key with
  `emporixKey(name, [args], { tenant, authKind, siteCode })`, stale-time 60s.
  `searchByCodes`'s hook follows that convention with a 30s stale-time
  (per requirement).

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Escaping (special chars `( ) , whitespace "`) | **Filter + warn**: drop unsafe codes before the request, `logger.warn` the dropped list, document it. Unquoted `code:(c1,c2)` like `searchByIds`. |
| D2 | Duplicate codes | Dedupe once (`new Set`) before querying. |
| D3 | Empty input / all-filtered | Return `[]` with no HTTP call. |
| D4 | Default auth | `ANON` (like `searchByIds`). |
| D5 | Order | Not guaranteed across chunks — consumers re-index by `code`. |
| D6 | Hook stale-time | 30s (requirement); existing constant is 60s. |

## 3. SDK method (`packages/sdk/src/services/product.ts`)

```ts
async searchByCodes(
  codes: string[],
  options: { chunkSize?: number } = {},
  auth: AuthContext = ANON,
): Promise<Product[]>
```

Algorithm:
1. `const unique = [...new Set(codes)];`
2. Partition into `safe` / `dropped` where unsafe = `/[(),"\s]/.test(code)`.
3. If `dropped.length > 0`: `this.ctx.logger.warn("products.searchByCodes: dropped codes containing query-delimiter characters", { dropped });`
4. If `safe.length === 0`: return `[]` (no HTTP).
5. `chunkSize = options.chunkSize ?? 100`; split `safe` into chunks.
6. `Promise.all(chunks.map(chunk => http.request<Product[]>({ method: "POST", path: \`/product/${tenant}/products/search\`, query: { pageSize: chunk.length }, auth, body: { q: \`code:(${chunk.join(",")})\` } })))` → `.flat()`.

JSDoc mirrors `searchByIds`, noting the filter-unsafe behavior and unguaranteed order.

## 4. React hook (`packages/react/src/hooks/use-products.ts`)

```ts
export function useProductsByCodes(
  codes: string[],
  options: { chunkSize?: number; auth?: AuthContext } = {},
): UseQueryResult<Product[]>
```

- `queryKey: emporixKey("products-by-codes", [codes, options.chunkSize], { tenant: client.tenant, authKind: ctx.kind, siteCode })`
- `enabled: codes.length > 0`
- `staleTime: 30_000`
- `queryFn: () => client.products.searchByCodes(codes, options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {}, ctx)`
- Exported from `packages/react/src/hooks/index.ts` (and thus the package index).

## 5. Tests

**SDK** (`packages/sdk/tests/services/product.test.ts`, add cases):
- 250 codes, `chunkSize: 100` → exactly 3 POSTs; result is the union of the three responses.
- Empty `codes` → no HTTP call, returns `[]`.
- Duplicate codes (`["A","A","B"]`) → query value contains `A` once (`code:(A,B)`).
- Unsafe codes (`["A","B C","D,E"]`) → request `q=code:(A)`, and a `warn` is emitted listing `["B C","D,E"]` (asserted via `MemoryLogger`).

**React** (`packages/react/tests/use-products.test.tsx`):
- `useProductsByCodes(["A","B"])` resolves to the mocked products.
- `useProductsByCodes([])` is disabled — no fetch fires.

## 6. Docs (`docs/products.md`)

- Add `searchByCodes` to the standard-reads list on line 4.
- Add a short section beside `searchByIds` showing usage and documenting that
  codes containing `(`, `)`, `,`, whitespace, or `"` are dropped (with a logged
  warning) because the Emporix `q` syntax uses those as delimiters.

## 7. Changeset

`.changeset/products-search-by-codes.md`:
```
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---
```
Describing `searchByCodes` + `useProductsByCodes`.

## 8. Out of scope (YAGNI)

- Changing `searchByIds` (stays unquoted, no dedup).
- Quoting / `compoundLogicalQuery` query forms.
- Retry/caching beyond the React hook's stale-time.

## 9. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/src/services/product.ts` | add `searchByCodes` |
| `packages/sdk/tests/services/product.test.ts` | add 4 test cases |
| `packages/react/src/hooks/use-products.ts` | add `useProductsByCodes` |
| `packages/react/src/hooks/index.ts` | export the hook (if not via `*`) |
| `packages/react/tests/use-products.test.tsx` | add 2 hook tests |
| `docs/products.md` | document `searchByCodes` |
| `.changeset/products-search-by-codes.md` | minor for both packages |
