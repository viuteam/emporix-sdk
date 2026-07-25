# Availability Admin CRUD — Design

**Date:** 2026-07-25
**Package:** `@viu/emporix-sdk`
**Service:** `AvailabilityService` (`client.availability`)
**Spec source:** `packages/sdk/specs/availability.yml` → generated `src/generated/availability/types.gen.ts`

## Goal

`AvailabilityService` today wraps two storefront reads (`get`, `getMany`). The
write surface — per-product create/update/delete, the bulk group, and the
per-site availability listing — is missing. This work adds those 7 operations.

## Scope

Extend the existing `AvailabilityService` class with flat methods. No new class,
no client wiring change, no constructor change.

**Verified against the generated types** (not the running coverage table): the
service has **14** operations, 2 are wrapped, so 12 are open — but **5 of those
are deprecated** and stay out, leaving **7** to implement.

### Excluded: the deprecated location-management group (5)

`GET/POST/PUT /locations/{site}`, `DELETE /locations/{location}`, and
`POST /search/locations` are all marked `deprecated: true` in
`availability.yml` (upstream removal 2026-09-01). `availability-types.ts`
already documents that the SDK deliberately does not wrap them; this work keeps
that stance, consistent with the deprecated endpoints skipped in #162 and #166.

### Already covered (unchanged)

`get` (GET `/availability/{productId}/{site}`) and `getMany` (POST
`/availability/search`), including their `defaultAvailableOnNotFound` behavior.

## Auth model

Writes default to `SERVICE` via a new
`const SERVICE: AuthContext = { kind: "service" }` next to the existing `ANON`,
always overridable through the trailing `auth` argument. The new site read
defaults to `ANON`, matching the existing reads (the service requires the
`availability.availability_view` scope on whichever token is used).

## API surface

### 1 — Site read

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `listForSite(siteCode, params?, auth?)` | GET `/availability/site/{site}` | ANON | `PaginatedItems<Availability>` |

`params`: `pageNumber?`, `pageSize?`, `q?` (raw string), `sort?`. The endpoint
returns a bare array (`AvailabilityList`), which is wrapped into the shared
`PaginatedItems` shape the way `OrdersService.listMine` does
(`hasNextPage` inferred from a full page).

### 2 — Per-product writes

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `create(productId, siteCode, input, auth?)` | POST `/availability/{productId}/{site}` | SERVICE | `AvailabilityCreated` (201) |
| `update(productId, siteCode, input, auth?)` | PUT `/availability/{productId}/{site}` | SERVICE | `AvailabilityCreated \| void` (201 create / 204 update) |
| `delete(productId, siteCode, auth?)` | DELETE `/availability/{productId}/{site}` | SERVICE | `void` (204) |

**Naming:** the PUT is called `update`, not `replace`. This endpoint has no
PATCH counterpart, so there is nothing to disambiguate — the same call the cart
service makes. Where both verbs exist (category #166, product #170, order-v2
#168) the established split stays `update` = PATCH, `replace` = PUT.

`create` returns 409 when the record already exists; `update` upserts (201 with
an id when it creates, 204 when it updates). Path segments are
`encodeURIComponent`-escaped, matching the existing `get`.

### 3 — Bulk (207 Multi-Status)

| Method | HTTP | Auth | Returns |
|---|---|---|---|
| `bulkCreate(input, options?, auth?)` | POST `/availability/bulk` | SERVICE | `AvailabilityBulkResult[]` (207) |
| `bulkUpdate(input, options?, auth?)` | PUT `/availability/bulk` | SERVICE | `AvailabilityBulkResult[]` (207) |
| `bulkDelete(input, options?, auth?)` | DELETE `/availability/bulk` | SERVICE | `AvailabilityBulkResult[]` (207) |

- `bulkCreate`/`bulkUpdate` take `AvailabilityBulkInput[]`; `bulkDelete` takes
  `AvailabilityBulkDeleteInput[]` — note that this DELETE **carries a body**.
- All three respond 207: partial failures do **not** throw; inspect each entry.
- `options = { vendorId?: string }` sets a request header limiting the operation
  to products of that vendor. The header is sent only when `vendorId` is given.

#### Deliberate deviation: the vendor header name

The generated schema declares the header as **`venodr-id`** — an evident
upstream typo (the corresponding body field is spelled `vendorId`). On the
maintainer's call this design sends **`vendor-id`** instead. This is a conscious
departure from the "follow the generated schema verbatim" rule applied elsewhere
in this series, and it is unverified: if the API really expects the misspelled
name, the filter silently does nothing (no error — just no vendor scoping).
Worth confirming against the live tenant before relying on it. Recorded here, in
the method docstring, and in the changeset.

### 4 — Public types (alias → generated)

Declared in `packages/sdk/src/services/availability-types.ts` (where the
existing `Availability` alias lives) and re-exported from
`services/availability.ts`. The root barrel `src/availability.ts` uses
`export *`, so **no `index.ts` change is needed**.

| Public alias | Generated type |
|---|---|
| `AvailabilityInput` | `AvailabilityDto` |
| `AvailabilityCreated` | `IdResponse` |
| `AvailabilityBulkInput` | `AvailabilityBulkDto` |
| `AvailabilityBulkDeleteInput` | `AvailabilityDeleteBulkDto` |
| `AvailabilityBulkResult` | `BulkResponse` |

The existing `Availability` alias (`AvailabilityWithBundle`) also types the site
listing: it is a true superset of the generated `Availability` used by
`AvailabilityList`, adding only the optional `bundleAvailabilities`.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy (409 on duplicate create, 404 on unknown record). The
existing `defaultAvailableOnNotFound` 404-swallowing stays confined to `get` /
`getMany`; the new methods propagate errors unchanged.

## Testing

New unit test `packages/sdk/tests/services/availability-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`payment-admin.test.ts`.

- **Site-read block:** `listForSite` GETs `/availability/site/{site}` with the
  `ANON` default, forwards paging/`q`/`sort`, and wraps the array into
  `PaginatedItems`.
- **Write block:** `create`/`update`/`delete` hit the right method + path with
  the `SERVICE` default; an explicit `auth` override is honored.
- **Bulk block:** all three hit `/availability/bulk` with the right method and
  send the body (including `bulkDelete`); the `vendor-id` header appears only
  when `vendorId` is passed and is absent otherwise.

## Release

Changeset `.changeset/availability-admin-crud.md`, `@viu/emporix-sdk` **minor**
(additive: new methods + types, no change to existing reads).

## Out of scope

- The 5 deprecated location-management endpoints (see above).
- React hooks (admin writes are server-side; the React bindings stay
  storefront-focused, consistent with prior admin PRs).
- Live verification of the `vendor-id` header spelling — flagged above as a
  follow-up.
