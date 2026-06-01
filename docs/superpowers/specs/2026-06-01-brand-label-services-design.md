# Brand + Label Services Binding — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Bind the Emporix **Brand Service** and **Label Service** into the SDK as two
small server-side services, `client.brands` and `client.labels`, each covering
full CRUD (6 operations). Planned and shipped together in one branch/PR — they
complete the `products-labels-and-brands` domain alongside the existing Product
and Category services.

## Background

Both are OAuth2/service-token services (no `CustomerAccessToken`), so they are
admin/config APIs — core-SDK only, no React hooks (consistent with Tax). Two
notable quirks:

- **Tenant-less paths.** Neither path carries a `{tenant}` segment — the tenant
  is derived from the (tenant-scoped) token.
  - Brand server `https://api.emporix.io`, paths `/brand/brands[/{brandId}]` → SDK path `/brand/brands`.
  - Label server `https://api.emporix.io/label`, path `/labels[/{labelId}]` → SDK path **`/label/labels`**.
- **Brand reads need no scope** (public); brand writes need `brand.brand_manage`,
  delete needs `brand.brand_delete`. Label uses `label.label_read` / `label.label_manage`.

## Design decisions

- **D1 — Scope:** Full CRUD for each service (list / get / create / update /
  patch / delete). (User-selected.)
- **D2 — Two services, one branch:** `BrandService` → `client.brands`,
  `LabelService` → `client.labels`; shipped together. (User-selected.)
- **D3 — No React:** service-token only. (User-selected.)
- **D4 — Service-token default:** every method defaults `auth` to
  `{ kind: "service" }`, overridable (brand reads also work with anonymous).
- **D5 — Types via codegen + aliasing:** add `brand-service` and `label-service`
  to `fetch-specs.ts`; `brand-types.ts` / `label-types.ts` alias the generated
  types. Final names + PATCH-body form + list-envelope-vs-array pinned at codegen.
- **D6 — Tenant-less base paths:** `base()` returns `/brand/brands` and
  `/label/labels` (no `this.ctx.tenant`); asserted in tests.

## Public types (final names pinned in codegen)

- **Brand:** `Brand` (read = `brandResponse`), `BrandList` (`brands`),
  `BrandInput` (create = `brand`), `BrandUpdate` (PUT/PATCH = `updateBrand`).
- **Label:** `Label` (read = `label`), `LabelList` (`labels`),
  `LabelInput` (create = `labelCreation`), `LabelUpdate` (PUT/PATCH = `labelUpdate`).

## Service surface

| `client.brands` | HTTP | Path | Returns |
|---|---|---|---|
| `listBrands(query?, auth?)` | GET | `/brand/brands` | `BrandList` |
| `getBrand(brandId, auth?)` | GET | `/brand/brands/{id}` | `Brand` |
| `createBrand(input, auth?)` | POST | `/brand/brands` | `Brand` |
| `updateBrand(brandId, input, auth?)` | PUT | `/brand/brands/{id}` | `Brand` |
| `patchBrand(brandId, patch, auth?)` | PATCH | `/brand/brands/{id}` | `Brand` |
| `deleteBrand(brandId, auth?)` | DELETE | `/brand/brands/{id}` | `void` |

| `client.labels` | HTTP | Path | Returns |
|---|---|---|---|
| `listLabels(query?, auth?)` | GET | `/label/labels` | `LabelList` |
| `getLabel(labelId, auth?)` | GET | `/label/labels/{id}` | `Label` |
| `createLabel(input, auth?)` | POST | `/label/labels` | `Label` |
| `updateLabel(labelId, input, auth?)` | PUT | `/label/labels/{id}` | `Label` |
| `patchLabel(labelId, patch, auth?)` | PATCH | `/label/labels/{id}` | `Label` |
| `deleteLabel(labelId, auth?)` | DELETE | `/label/labels/{id}` | `void` |

`brandId` / `labelId` are `encodeURIComponent`-escaped. Exact create/update/
patch response shapes (full body vs 204) pinned at codegen.

## Error handling

Shared `errorFromResponse` via `HttpClient`. No service-specific errors.

## Testing

- **Core (Vitest + MSW):** `brand-types.test.ts`/`label-types.test.ts`,
  `brand.test.ts`/`label.test.ts` (each method: `Bearer svc-tok`, the tenant-less
  paths `/brand/brands` & `/label/labels`, bodies, `encodeURIComponent`, 404),
  `brand-wiring.test.ts`/`label-wiring.test.ts` (one combined wiring test is fine).

## Out of scope

Nothing within either service is deferred (brand/label media-management
sub-resources, if any, are bound only if part of the core CRUD). No React.

## Deliverables

Codegen (both) + `brand-types.ts`/`label-types.ts` + `BrandService`/`LabelService`
+ wiring (loggers `"brand"`/`"label"`, facades `src/brand.ts`/`src/label.ts`,
barrel) + `docs/brand.md`/`docs/label.md` + CLAUDE.md + changeset (minor,
`@viu/emporix-sdk` only). Branch `feat/brand-label-services` off `main`.
