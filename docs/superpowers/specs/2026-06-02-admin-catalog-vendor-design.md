# Admin: Catalog + Vendor Services (Batch 2) — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Batch 2 of the admin set: bind **Catalog Management** (`client.catalogs`) and
**Vendor Service** (`client.vendors`) in one branch. ~18 ops total.

## Background

Both OAuth2/service-token (no `CustomerAccessToken`) → core-SDK only, no React.
Standard tenant base paths. Catalog `PATCH` uses a partial-properties body
(`UpdateCatalogProperties`), not a JSON-Patch op-array; the DELETE-catalog body
is optional (not sent). Vendor/location creates return a `resourceId`. The
vendor service has its own `locations` sub-resource (vendor pickup/warehouse
locations) — bound as `*VendorLocation*` methods to disambiguate from the
existing customer-management `client.locations`.

## Design decisions

- **D1 — Scope:** full surface (catalog 7, vendor 11).
- **D2 — Two services, one branch:** `client.catalogs`, `client.vendors`.
- **D3 — No React; service-token default, overridable.**
- **D4 — Types via codegen + aliasing.** Catalog create/upsert →
  `CreateCatalogResponse`; patch body `UpdateCatalogProperties`. Vendor/location
  create → `resourceId`; PUT is upsert. List/search shapes (array vs envelope)
  and the vendor search body pinned at codegen.

## Public types (final names pinned at codegen)

- **Catalog:** `Catalog` (read), `CatalogList`, `CatalogInput` (`CreateCatalog`),
  `CatalogUpdate` (`UpdateCatalog`, PUT), `CatalogPatch` (`UpdateCatalogProperties`),
  `CatalogCreated` (`CreateCatalogResponse`).
- **Vendor:** `Vendor` (read), `VendorList`, `VendorInput` (`VendorCreate`),
  `VendorUpdate` (`VendorUpdate`), `VendorCreated` (`ResourceId`),
  `VendorSearchQuery` (search body); `VendorLocation` (`Location`),
  `VendorLocationList`, `VendorLocationInput` (`LocationCreate`),
  `VendorLocationUpdate` (`LocationUpdate`).

## Service surface

**`client.catalogs`** (`/catalog/{tenant}/catalogs`)
| Method | HTTP |
|---|---|
| `listCatalogs(query?, auth?)` | GET `/catalogs` |
| `getCatalog(catalogId, auth?)` | GET `/catalogs/{catalogId}` |
| `getCatalogsForCategory(categoryId, auth?)` | GET `/catalogs/categories/{categoryId}` |
| `createCatalog(input, auth?)` | POST `/catalogs` → `CatalogCreated` |
| `updateCatalog(catalogId, input, auth?)` | PUT `/catalogs/{catalogId}` (upsert) → `CatalogCreated` |
| `patchCatalog(catalogId, patch, auth?)` | PATCH `/catalogs/{catalogId}` |
| `deleteCatalog(catalogId, auth?)` | DELETE `/catalogs/{catalogId}` |

**`client.vendors`** (`/vendor/{tenant}`)
| Method | HTTP |
|---|---|
| `listVendors(query?, auth?)` / `getVendor(vendorId, auth?)` | GET `/vendors[/{vendorId}]` |
| `searchVendors(query, auth?)` | POST `/vendors/search` |
| `createVendor(input, auth?)` | POST `/vendors` → `VendorCreated` |
| `updateVendor(vendorId, input, auth?)` | PUT `/vendors/{vendorId}` (upsert) |
| `deleteVendor(vendorId, auth?)` | DELETE `/vendors/{vendorId}` |
| `listVendorLocations(query?, auth?)` / `getVendorLocation(locationId, auth?)` | GET `/locations[/{locationId}]` |
| `createVendorLocation(input, auth?)` | POST `/locations` → `VendorCreated` |
| `updateVendorLocation(locationId, input, auth?)` | PUT `/locations/{locationId}` (upsert) |
| `deleteVendorLocation(locationId, auth?)` | DELETE `/locations/{locationId}` |

Path segments `encodeURIComponent`-escaped. Create/upsert/patch/delete response
codes and list envelopes pinned at codegen.

## Error handling

Shared `errorFromResponse` via `HttpClient`. No service-specific errors.

## Testing

Per service: `*-types.test.ts`, `*.test.ts` (MSW — token, paths, bodies, search
POST, `encodeURIComponent`, 404), one combined wiring test.

## Out of scope

Other admin batches: 3) pick-pack · 4) customer-service + client-management ·
5) approval (React).

## Deliverables

Codegen (2) + 2 type modules + 2 services + wiring (loggers `"catalog"`/`"vendor"`,
facades `src/{catalog,vendor}.ts`, barrel) + `docs/{catalog,vendor}.md` + CLAUDE.md
+ changeset (minor, `@viu/emporix-sdk` only). Branch `feat/admin-catalog-vendor` off `main`.
