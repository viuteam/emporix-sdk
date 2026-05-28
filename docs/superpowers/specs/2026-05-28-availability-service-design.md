# Availability Service — Design

**Date:** 2026-05-28
**Status:** Approved (pending written-spec review)
**Packages:** `@viu/emporix-sdk` (core), `@viu/emporix-sdk-react` (hooks)

## Goal

Add an `AvailabilityService` to the SDK (and matching React hooks) that reads
site-aware product availability from the Emporix Availability Service, with an
opt-in graceful fallback for tenants that do not run stock management.

## Background — the real Emporix Availability API

Verified against the live Emporix OpenAPI (developer.emporix.io, Availability
Service v0.0.1). Relevant endpoints:

| Endpoint | Method | Use |
|---|---|---|
| `/availability/{tenant}/availability/{productId}/{site}` | GET | single product → `get()` |
| `/availability/{tenant}/availability/search` | POST | **batch read** → `getMany()` |
| `/availability/{tenant}/availability/site/{site}` | GET | all records for a site (not used) |
| `/availability/{tenant}/availability/bulk` | POST | write/upsert, max 200 (not used) |

**Scopes:** `availability.availability_view` (clientCredentials / service token).
The anonymous (storefront) token works **only if** the tenant's storefront
client carries that read scope — the same assumption `PriceService.matchByContext`
already makes. `auth.service()` is the always-works fallback.

### Response schema (`AvailabilityWithBundle`)

The single GET and the batch search both return the bundle-aware variant:

```
id            string   "{site}:{productId}"
site          string
available     boolean
stockLevel    number?   (optional — absent when stock isn't tracked)
productId     string
vendorId      string?
popularity    integer?
distributionChannel  "ASSORTMENT" | "HOME_DELIVERY" | "PICKUP"  (optional)
bundleAvailabilities AvailabilityWithBundle[]?   (present for bundles)
mixins        object?   (additionalProperties)
metadata      { createdAt?, modifiedAt?, mixins? }?
```

**There is no `restockDate` / "available date" field** anywhere in the API. The
original requirement text listed one; it does not exist and is dropped.

### Batch read — `POST /availability/{tenant}/availability/search`

- Query params: `site` (optional but always sent here), `pageSize`, `pageNumber`, `sort`.
- Request body (the form we use): a **plain JSON array of product-id strings**,
  e.g. `["PRODUCT-1","PRODUCT-2"]`. (A `{ q }` query-object body also exists but
  excludes bundles and forbids `site`; not used.)
- Response: `AvailabilityWithBundleList` (array of `AvailabilityWithBundle`) +
  `X-Total-Count` header. Products with **no availability record are simply
  absent** from the array — there is no per-item 404.

## Public API

```ts
export type Availability = AvailabilityWithBundle; // from generated/availability

class AvailabilityService {
  constructor(ctx: ClientContext); // same shape as every service (ctx.http/.tenant/.logger)

  get(
    productId: string,
    siteCode: string,
    auth?: AuthContext,
    opts?: { defaultAvailableOnNotFound?: boolean },
  ): Promise<Availability>;

  getMany(
    productIds: string[],
    siteCode: string,
    auth?: AuthContext,
    opts?: { defaultAvailableOnNotFound?: boolean },
  ): Promise<Availability[]>;
}
```

Exposed on the client as `client.availability`.

### Auth

Default `auth.anonymous()` (mirrors `PriceService.matchByContext`). Accepts
`customer` / `raw` / `service` with **no restriction** — availability read is
valid on any kind, and `service` is what exercises the inherited 401-refresh-retry.
No `requireContextAuth`-style guard.

### `get()` behaviour

- `GET /availability/{tenant}/availability/{enc(productId)}/{enc(siteCode)}`.
- `200` → the `Availability`.
- `404`:
  - `opts.defaultAvailableOnNotFound === true` → return enriched default
    `{ productId, site: siteCode, available: true }`.
  - otherwise → rethrow the `EmporixNotFoundError`.
- `defaultAvailableOnNotFound` defaults **false** (opt-in).
- Other non-2xx propagate as the usual `EmporixError` subclasses.
- 401 on a `service`/`anonymous` context refreshes-and-retries once (inherited
  from `HttpClient`; no service-level code).

### `getMany()` behaviour

- Empty `productIds` → resolve `[]` immediately (no HTTP call).
- One `POST /availability/{tenant}/availability/search?site={enc(siteCode)}&pageSize={productIds.length}`
  with body `productIds`. `pageSize = productIds.length` guarantees a single page
  (one record per product because `site` is fixed).
- Build `Map<productId, Availability>` from the response.
- Map **input order**: for each `productId`, use the found record, else synthesize
  `{ productId, site: siteCode, available: Boolean(opts?.defaultAvailableOnNotFound) }`.
  - flag off → missing product = `{ available: false }`.
  - flag on  → missing product = `{ available: true }`.
- Result is always `length === productIds.length` and **order === input order**.
- No `concurrency` option (single request — nothing to parallelize). No dedupe.
- Because it's a single request, any non-2xx (400/401/403/500) fails the whole
  call atomically; the 401-refresh-retry applies as in `get()`.

## Types — codegen

The repo generates all service types from `specs/*.yml` via
`pnpm generate` (`@hey-api/openapi-ts`, types-only) into
`src/generated/<svc>/types.gen.ts` (auto-bannered `// AUTO-GENERATED — do not edit`).

- Add `packages/sdk/specs/availability.yml` — a trimmed OpenAPI document holding
  the `Availability`, `AvailabilityWithBundle`, `AvailabilityWithBundleList`,
  `DistributionChannel` schemas and the single-GET + search operations.
- Run `pnpm -F @viu/emporix-sdk generate`. It re-reads **all** specs; stage only
  `src/generated/availability/` after confirming the other generated dirs are
  unchanged (committed specs regenerate idempotently).
- The service imports `AvailabilityWithBundle` from `../generated/availability`
  and re-exports `export type Availability = AvailabilityWithBundle`.

## Wiring

- `src/services/availability.ts` — the `AvailabilityService` implementation.
- `src/availability.ts` — subpath barrel: `export * from "./services/availability";`.
- `src/client.ts` — `readonly availability: AvailabilityService;` constructed via
  `new AvailabilityService(mk("availability"))`.
- `src/core/logger.ts` — add `"availability"` to the `ServiceName` union.
- `src/index.ts` — re-export the service module (main barrel).
- `tsup.config.ts` — add `"src/availability.ts"` to `entry`.
- `package.json#exports` — add `"./availability"` (types/import/require → `./dist/availability.*`).
- `commitlint.config.js` — add `"availability"` to the `scope-enum` allowlist so
  `feat(availability): …` commits pass the husky `commit-msg` hook (it is not
  currently allowed). Do this in the **first** commit of the branch.

## React hooks — `@viu/emporix-sdk-react`

`packages/react/src/hooks/use-availability.ts` and `use-availabilities.ts`.
`Availability` is re-exported from `@viu/emporix-sdk`.

```ts
const AVAILABILITY_STALE_TIME = 30_000; // 30s

useAvailability(
  productId: string,
  siteCode: string,
  options?: { enabled?: boolean; customerToken?: string | null; defaultAvailableOnNotFound?: boolean },
): UseQueryResult<Availability>;

useAvailabilities(
  productIds: string[],
  siteCode: string,
  options?: { enabled?: boolean; customerToken?: string | null; defaultAvailableOnNotFound?: boolean },
): UseQueryResult<Availability[]>;
```

- Auth: `customerToken` → `auth.customer(token)`, else `auth.anonymous()` (mirrors `useMatchPrices`).
- `useAvailability` query key: `["emporix","availability",{ tenant, productId, siteCode, anon, defaultAvailableOnNotFound }]`;
  `enabled` requires both `productId` and `siteCode`.
- `useAvailabilities` is a **single** `useQuery` calling `client.availability.getMany`;
  key: `["emporix","availabilities",{ tenant, productIds, siteCode, anon, defaultAvailableOnNotFound }]`;
  `enabled` requires `productIds.length > 0`.
- `staleTime: 30_000` on both.
- Register both in `packages/react/src/hooks/index.ts` and the package barrel.

## Tests

### SDK — `packages/sdk/tests/availability.test.ts` (Vitest + MSW)

- `get` happy path: `200` → returns the record.
- `get` 404 without flag → rejects with `EmporixNotFoundError`.
- `get` 404 with `defaultAvailableOnNotFound: true` → `{ productId, site, available: true }`.
- `get` with `auth.service()`: MSW returns `401` once then `200` → resolves
  (asserts inherited refresh-and-retry; token endpoint hit twice).
- `getMany` mix: request 3 ids, search returns 2 → result length 3, **order matches input**,
  missing id is `{ available: false }` (flag off) / `{ available: true }` (flag on).
- `getMany` empty array → `[]`, no HTTP request made.
- `getMany` response in scrambled order → re-sorted to input order.

### React — `packages/react/tests/`

- `use-availability.test.tsx` — renders, asserts `data.available`.
- `use-availabilities.test.tsx` — renders with 2 ids, asserts ordered array.

(MSW handlers as in existing hook tests; jsdom env.)

## Docs — `docs/availability.md`

Overview; scope note (`availability.availability_view`, storefront-token caveat,
server-only nature); `get` / `getMany` examples; the `defaultAvailableOnNotFound`
storefront pattern; React `useAvailability` / `useAvailabilities` examples;
explicit note that there is **no restock-date field**. Linked from the SDK README
"Subpath exports" list and the service table.

## Changeset

`.changeset/availability-service.md` — both packages at **minor**:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add AvailabilityService (`client.availability.get` / `.getMany`) and the
`useAvailability` / `useAvailabilities` React hooks for site-aware product
availability, with an opt-in `defaultAvailableOnNotFound` fallback.
```

Listing **both** packages explicitly as `minor` is deliberate: `@viu/emporix-sdk`
is a `workspace:^` peer of the React package, so an unlisted React package would
be force-**major**ed as a peer-dependent. Both go `2.0.0 → 2.1.0`; `linked`
config keeps them equal.

## Out of scope (YAGNI)

- Write/upsert (`bulk`), the site-wide list GET, and the `{ q }` query-object
  search body.
- Pagination/chunking for `getMany` (single page sized to input is sufficient for
  storefront use; revisit only if callers batch hundreds of ids).
- `restockDate` / availability-date (does not exist in the API).
- A `concurrency` option (obsolete with the single batch request).
