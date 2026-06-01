# Fee Service Binding — Design

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Package:** `@viu/emporix-sdk` (core only)
- **Branch:** `feat/fee-service`

## 1. Context & motivation

The SDK exposes a service binding per Emporix Commerce Engine service. The
**Fee Service** (`/fee/{tenant}/…`) is not yet bound. It manages configurable
checkout fees — percentage, absolute, or per-item-quantity surcharges (e.g.
small-order fees, payment surcharges, deposit/recycling fees) — plus the
mappings that attach fees to individual catalog items (`itemFees`) or products
(`productFees`).

This design adds bindings for the fee definitions and their item/product
mappings as **one core service**, consumed **server-side only**. No React
bindings.

### Upstream API summary (verified against the live OpenAPI + docs)

- **Auth:** OAuth2 `clientCredentials` only. This is an **admin/service token**,
  never to be exposed in a browser. Write scopes:
  - `fee.fee_create` / `fee.fee_update` / `fee.fee_delete` — fee definitions
  - `fee.item_create` / `fee.item_update` / `fee.item_delete` — item/product mappings
  - GET endpoints have **empty security** (a valid token, but no scope required).
- **Base path:** `/fee/{tenant}`
- **Fee definitions** — `/fee/{tenant}/fees`
  - `GET /fees` — list (paginated, no scope)
  - `POST /fees` — create (`fee.fee_create`)
  - `GET /fees/{id}` — retrieve one (no scope)
  - `PUT /fees/{id}` — update one (`fee.fee_update`)
  - `DELETE /fees/{id}` — delete (`fee.fee_delete`)
- **Item fees** — `/fee/{tenant}/itemFees`
  - `GET /itemFees` — list all item-fee mappings (no scope)
  - `POST /itemFees` — create a mapping (`fee.item_create`)
  - `GET /itemFees/{itemYRN}/fees` — mappings for one item YRN (no scope)
  - `PUT /itemFees/{itemYRN}/fees` — set the fee list for one item YRN
    (`fee.item_update`); **destructive replace** unless `?partial=true`
  - `DELETE /itemFees/{itemYRN}/fees` and `…/fees/{feeId}` — delete all / one
    mapping for an item YRN (`fee.item_delete`)
  - `POST /itemFees/search` — search by item YRNs + site (body `{ itemYrns[], siteCode }`)
- **Product fees** — `/fee/{tenant}/productFees`
  - `GET /productFees/{productId}/fees` — mappings for a product (no scope)
  - `PUT /productFees/{productId}/fees` — set the fee list for a product (`fee.item_update`)
  - `DELETE /productFees/{productId}/fees` — delete all mappings for a product (`fee.item_delete`)
- **`Fee` shape (response):**
  - `id: string` (server-assigned)
  - `name: object` (localized map, e.g. `{ en: "Small order fee" }`)
  - `description?: object` (localized)
  - `code: string` (**required**, ≤100 chars). For a payment-type fee this
    **must equal the payment-mode code** or the fee is silently ignored.
  - `feeType: "PERCENT" | "ABSOLUTE" | "ABSOLUTE_MULTIPLY_ITEMQUANTITY"`
  - `feePercentage?: number` (present iff `feeType === "PERCENT"`)
  - `feeAbsolute?: { amount: number; currency: string }` (present iff `ABSOLUTE*`)
  - `itemType?: "PRODUCT" | "PAYMENTTYPE"`
  - `siteCode: string` (**required**; filters silently — wrong/missing → empty array)
  - `active: boolean` (**required**)
  - `taxable?: boolean`
  - `taxCode?: string` (**required if `taxable`**)
  - `activeTimespan?: { startDate: string; endDate: string }` (expiry silently disables)
  - `yrn: string` (server-assigned)
- **`ItemFee` shape:**
  - `id: string` (server-assigned)
  - `itemYrn: string` (**required**)
  - `feeIds: string[]` (**required**)
  - `siteCode: string` (**required**)

## 2. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | `/fees` CRUD + `/itemFees` (list/get-by-yrn/create/set/delete + search) + `/productFees` get/set/delete. See §9 for deferred endpoints. |
| D2 | React bindings | **None** — core SDK only, server-side consumption |
| D3 | API shape | **One service**: `client.fees` (single `FeeService`, like `media`/`price`). Item/product-fee methods are name-prefixed (`listItemFees`, `setItemFees`, …) rather than nested sub-objects (YAGNI) |
| D4 | Method name for DELETE | `delete` for fee defs (precedent: `tenant-config.ts`); `deleteItemFees` / `deleteProductFees` for mappings (verb-prefixed to disambiguate the three resource families) |
| D5 | Types source | Codegen via existing `@hey-api/openapi-ts` pipeline + thin public aliases (`Fee`, `ItemFee`, draft inputs) |
| D6 | Default auth | `{ kind: "service" }` (credential set `"backend"`), overridable per call — identical to `price.ts` / `media.ts` / `tenant-config.ts` |
| D7 | List pagination | `GET /fees` wrapped in the shared `PaginatedItems<Fee>` envelope (precedent: `media.list`), defaults `pageNumber: 1`, `pageSize: 60` |
| D8 | `partial` on set-item-fees | exposed as a boolean option (`{ partial?: boolean }`) serialized to `?partial=true`; default omitted (destructive replace = server default) |

## 3. Public API surface

```ts
// types (src/services/fee-types.ts) — thin aliases over generated wire types
export type Fee = GenFee;                       // response shape
export type ItemFee = GenItemFee;               // response shape
export type FeeDraft = GenFeeDraft;             // create/update body (no id/yrn)
export type ItemFeeDraft = GenItemFeeDraft;     // create body
export type LocalizedString = { [locale: string]: string };

/** Body of POST /itemFees/search. */
export interface ItemFeeSearch {
  itemYrns: string[];
  siteCode: string;
}

/** Options for the paginated fee list. Open index signature mirrors `media`. */
export interface ListFeesQuery {
  pageNumber?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
  [key: string]: string | number | undefined;
}

/** Options for set-item-fees / set-product-fees. */
export interface SetItemFeesOptions {
  /** When true, merges instead of replacing (serialized to `?partial=true`). */
  partial?: boolean;
}
```

```ts
// client.fees — FeeService

// Fee definitions
list(query?: ListFeesQuery, auth?: AuthContext): Promise<PaginatedItems<Fee>>
get(id: string, auth?: AuthContext): Promise<Fee>
create(draft: FeeDraft, auth?: AuthContext): Promise<Fee>
update(id: string, draft: FeeDraft, auth?: AuthContext): Promise<Fee>
delete(id: string, auth?: AuthContext): Promise<void>

// Item-fee mappings
listItemFees(auth?: AuthContext): Promise<ItemFee[]>
getItemFees(itemYrn: string, auth?: AuthContext): Promise<ItemFee[]>
createItemFee(draft: ItemFeeDraft, auth?: AuthContext): Promise<ItemFee>
setItemFees(itemYrn: string, feeIds: string[], opts?: SetItemFeesOptions, auth?: AuthContext): Promise<ItemFee>
deleteItemFees(itemYrn: string, feeId?: string, auth?: AuthContext): Promise<void>
searchItemFees(search: ItemFeeSearch, auth?: AuthContext): Promise<ItemFee[]>

// Product-fee mappings
getProductFees(productId: string, auth?: AuthContext): Promise<ItemFee[]>
setProductFees(productId: string, feeIds: string[], opts?: SetItemFeesOptions, auth?: AuthContext): Promise<ItemFee>
deleteProductFees(productId: string, auth?: AuthContext): Promise<void>
```

### Behavioral notes
- `list` mirrors `media.list`: server defaults (`pageNumber: 1`, `pageSize: 60`),
  `hasNextPage = items.length === pageSize`. Extra `q`/`sort` filters pass through.
- `setItemFees` / `setProductFees` PUT a body shaped per the upstream
  `/itemFees/{yrn}/fees` schema (the `feeIds` list). The PUT is a **destructive
  replace** unless `opts.partial` adds `?partial=true`. This is called out in
  the doc and a dedicated test.
- `deleteItemFees(itemYrn)` deletes **all** mappings for the YRN;
  `deleteItemFees(itemYrn, feeId)` deletes a single fee from the mapping
  (routes to `…/fees/{feeId}`).
- `itemYrn`, `productId`, `feeId`, and `id` are `encodeURIComponent`-escaped in
  paths (YRNs contain `:` and `;`).
- `searchItemFees` POSTs `{ itemYrns, siteCode }` to `/itemFees/search`.
- `siteCode` filters silently across the API: a wrong/missing site yields an
  empty array, not an error — documented, not defended against in code.

## 4. Auth & data flow

- Module-level default: `const SERVICE: AuthContext = { kind: "service" }`
  (resolves to the `"backend"` credential set via `DefaultTokenProvider.getToken`).
  Every method takes a trailing optional `auth` defaulting to `SERVICE` —
  including the GET endpoints, which carry no scope but still need a token.
- All requests go through `this.ctx.http.request<T>({ method, path, query, body, auth })`
  (the same method `media.ts` / `tenant-config.ts` call).
- Paths (all under `/fee/${tenant}`):
  - `/fee/${tenant}/fees` and `…/fees/${enc(id)}`
  - `/fee/${tenant}/itemFees`, `…/itemFees/${enc(yrn)}/fees`,
    `…/itemFees/${enc(yrn)}/fees/${enc(feeId)}`, `…/itemFees/search`
  - `/fee/${tenant}/productFees/${enc(productId)}/fees`
- Server-only contract is documented; no anonymous/customer default, no React surface.

## 5. Codegen integration

1. `packages/sdk/scripts/fetch-specs.ts` — add to `SPECS`:
   ```ts
   fee: `${BASE}/checkout/fee/api-reference/api.yml`,
   ```
   (URL verified live → HTTP 200:
   `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/checkout/fee/api-reference/api.yml`.)
2. `pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate`
   → produces `src/generated/fee/{index.ts,types.gen.ts}` (types only).
3. Public aliases in `src/services/fee-types.ts` import the generated base types
   and re-export them under stable SDK names. If hey-api emits names other than
   `Fee` / `ItemFee` / the draft bodies, alias accordingly — the thin layer
   absorbs that. The implementation plan includes a `grep` step to discover the
   actual emitted names and a defined fallback (a hand-written interface) if the
   generated draft type is unusable.

## 6. Wiring

- `src/core/logger.ts`: add `"fee"` to the `ServiceName` union (insert before `"http"`).
- `src/client.ts`:
  - import `FeeService`
  - add `readonly fees: FeeService`
  - construct with `mk("fee")` (next to `this.availability = …`)
- `src/index.ts`: re-export the public facade (`export * from "./fee";`).
- `src/fee.ts`: one-line `export * from "./services/fee";`.

## 7. Error handling

Reuse the existing HTTP error mapping in `core/http` + `core/errors`:
- 404 → `EmporixNotFoundError` (propagates from `get`/`update`/`delete`)
- 409 → existing conflict error (create/update)
- 400 → existing validation error
No service-specific catch logic (unlike `availability`'s default-on-404 helper).
The silent-filter quirks (wrong `siteCode` → `[]`, mismatched payment `code`,
expired `activeTimespan`) are **server behaviors**, not error paths — documented,
not handled.

## 8. Testing (Vitest + MSW)

`tests/services/fee.test.ts` (MSW harness: mock
`POST https://api.emporix.io/oauth/token` → `{ access_token: "svc-tok",
token_type: "Bearer", expires_in: 3599 }`, build `FeeService` directly, assert
`Authorization: Bearer svc-tok`):
- `list` wraps results in `PaginatedItems` with server-default page params;
  `hasNextPage` true when the page is full
- `list` passes through `q` / `sort` / page params as query
- `get` happy path; `get` → 404 throws `EmporixNotFoundError`
- `create` POSTs the `FeeDraft` and returns the created `Fee`
- `update` PUTs the draft to `/fees/{id}` and returns the updated `Fee`
- `delete` → 204 resolves to `void`
- `listItemFees` / `getItemFees` GET the right paths
- `createItemFee` POSTs `{ itemYrn, feeIds, siteCode }`
- `setItemFees` PUTs to `/itemFees/{yrn}/fees`; with `partial: true` adds
  `?partial=true` (dedicated test for the destructive-vs-partial quirk)
- `deleteItemFees(yrn)` hits `…/fees`; `deleteItemFees(yrn, feeId)` hits `…/fees/{feeId}`
- `searchItemFees` POSTs `{ itemYrns, siteCode }` to `/itemFees/search`
- `getProductFees` / `setProductFees` / `deleteProductFees` hit `/productFees/{id}/fees`
- `encodeURIComponent`-escapes a `:`-bearing YRN in the path
- Authorization header carries the **service** token on at least one GET and one write
- Wiring test: `new EmporixClient(...).fees instanceof FeeService`

## 9. Out of scope (YAGNI)

- React hooks / `@viu/emporix-sdk-react` surface
- e2e (admin token must not live in the vite-spa)
- `POST /itemFees/searchByProductId` and `POST /itemFees/searchByProductIds`
  — the YRN-based `searchItemFees` covers the common case; product-id search can
  be added if a consumer needs it. Documented as deferred.
- Localized-string helpers / fee-calculation/preview helpers (server computes fees)
- Optimistic-locking / version helpers
- Caching

## 10. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `fee` spec entry |
| `packages/sdk/specs/fee.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/fee/**` | generated (committed) |
| `packages/sdk/src/services/fee-types.ts` | new — public types |
| `packages/sdk/src/services/fee.ts` | new — `FeeService` |
| `packages/sdk/src/fee.ts` | new — re-export |
| `packages/sdk/src/core/logger.ts` | add `"fee"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `fees` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/fee.test.ts` | new tests |
| `docs/fee.md` | new — usage doc |
| `CLAUDE.md` | add Fee to the service list |
| `.changeset/fee-service.md` | minor: new `client.fees` service |
