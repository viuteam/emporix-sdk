# Media Service (BLOB + LINK) & Product Attachment — Design

**Date:** 2026-05-20
**Status:** Approved (design)

## Goal

Add first-class SDK support for Emporix's **Media** service so consumers can
create media assets (binary upload or external-URL link) and associate them
with products. Remove the existing broken `ProductService.media` (calls a
non-existent endpoint).

## Decisions (locked with the user)

| # | Decision |
|---|----------|
| 1 | Support **both** upload modes: `BLOB` (multipart/form-data binary) and `LINK` (JSON external URL). |
| 2 | **Remove** `ProductService.media` entirely (breaking; the endpoint it called doesn't exist in the Product API). |
| 3 | Provide convenience helpers: `uploadFile`, `link`, `attachToProduct`, `detachFromProduct`, `listForProduct`. |
| 4 | React: a **thin** `useProductMedia(productId)` reading from `useProduct(productId).productMedia` — **no** Media-Service call from the browser (Media reads need a service-only scope). |

## Validated Emporix API facts

Sources:
`https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/media/media/api-reference/api.yml`,
`https://developer.emporix.io/api-references/api-guides/media/media/`.

- **Host/base:** `https://api.emporix.io/media/{tenant}/...` (no separate
  subdomain).
- **Paths (exhaustive):**
  - `POST /media/{tenant}/assets` — create asset (BLOB or LINK).
  - `GET /media/{tenant}/assets` — list assets.
  - `GET /media/{tenant}/assets/{assetId}` — retrieve.
  - `PUT /media/{tenant}/assets/{assetId}` — update.
  - `DELETE /media/{tenant}/assets/{assetId}` — remove.
  - `GET /media/{tenant}/assets/{assetId}/download` — download (PUBLIC →
    redirect; PRIVATE → bytes). **Out of scope** in this initiative.
- **One endpoint, two modes** distinguished by `Content-Type`:
  - **BLOB** — `Content-Type: multipart/form-data`. Form parts: `file`
    (binary, max 10 MB) and `body` (a JSON string of `AssetCreateBlob`).
    `AssetCreateBlob`: `type: "BLOB"` (req), `access: "PUBLIC"|"PRIVATE"`
    (req), optional `id`, `refIds[] {type, id}`, `details {filename,
    mimeType}`.
  - **LINK** — `Content-Type: application/json`. Body `AssetCreateLink`:
    `type: "LINK"` (req), `access` (req), `url: string` (req), optional
    `id`, `refIds[]`.
- **`refIds`** is the **only** product-attachment mechanism. There is **no**
  `/product/{tenant}/products/{id}/media` endpoint on the Product service.
  Entry: `{ type: "PRODUCT" | "CATEGORY" | "BRAND" | "LABEL" | "MODULE" | <custom>; id: string }`.
- **201 response:** `{ id: string }`. The full asset is retrieved separately
  via GET.
- **Auth/scopes:** `media.asset_manage` (write), `media.asset_read` (read).
  **Client-credentials (service) token only** — these scopes are not granted
  to anonymous/customer tokens. The SDK defaults all Media calls to
  `{ kind: "service" }`.
- **Product `productMedia` field** (read-only on `GET /products/{id}`)
  remains the **storefront read path**: it is denormalized by the platform
  with `id`, `url`, `cloudinaryUrl`, `contentType`, etc.

### Bug discovered in the existing SDK

`ProductService.media.list` calls `GET /product/{tenant}/products/{id}/media`
— **this path does not exist** in the Product service. The method has been
dead since introduction; the only consumer is the SDK's own
`facade-coverage.test.ts`. Removal is in scope (Decision 2).

## Architecture

### A. Codegen + HTTP layer

- `scripts/fetch-specs.ts`: add `media` entry pointing at the media spec URL.
- `scripts/generate.ts`: emits `src/generated/media/` (idempotent, banner —
  same pattern as existing services).
- Record the canonical generated symbols in
  `docs/superpowers/plans/plan-media-type-bindings.md` (`AssetCreateBlob`,
  `AssetCreateLink`, `GetAssetBlob`/`GetAssetLink`, `Asset` (union), the
  asset-list response, the refId entry, the patch DTO).
- **`HttpClient.request` — additive FormData support.** In
  `packages/sdk/src/core/http.ts`, change the request-init body branch so
  that when `o.body instanceof FormData`:
  - do **not** `JSON.stringify` (assign the FormData directly), and
  - do **not** set `Content-Type` (`fetch` sets it with the boundary).
  JSON behaviour is unchanged.
  This is a tiny, backward-compatible change covered by a focused unit test.

### B. `MediaService`

New service `packages/sdk/src/services/media.ts`. Default auth `service`
across all methods (the scopes are backend-only).

```ts
export class MediaService {
  // CRUD over /media/{tenant}/assets
  list(query?: AssetListQuery, auth?: AuthContext): Promise<Asset[]>
  get(assetId: string, auth?: AuthContext): Promise<Asset>
  update(assetId: string, patch: AssetUpdate, auth?: AuthContext): Promise<Asset>
  remove(assetId: string, auth?: AuthContext): Promise<void>

  // Create — one method, discriminated by input.kind
  create(
    input:
      | { kind: "blob"; file: Blob; body: AssetCreateBlob }
      | { kind: "link"; body: AssetCreateLink },
    auth?: AuthContext,
  ): Promise<{ id: string }>

  // Convenience helpers (built on create + update)
  uploadFile(
    input: { file: Blob; productId?: string; filename?: string;
             mimeType?: string; access?: "PUBLIC" | "PRIVATE" },
    auth?: AuthContext,
  ): Promise<{ id: string }>

  link(
    input: { url: string; productId?: string;
             access?: "PUBLIC" | "PRIVATE" },
    auth?: AuthContext,
  ): Promise<{ id: string }>

  attachToProduct(assetId: string, productId: string, auth?: AuthContext): Promise<Asset>
  detachFromProduct(assetId: string, productId: string, auth?: AuthContext): Promise<Asset>

  listForProduct(productId: string, auth?: AuthContext): Promise<Asset[]>
}
```

- `create({ kind: "blob", file, body })`: constructs a `FormData` with two
  parts — `file` (the `Blob`) and `body` (a `JSON.stringify(body)` string) —
  and POSTs to `/media/{tenant}/assets` with the new FormData branch of
  `HttpClient`.
- `create({ kind: "link", body })`: POSTs the body as JSON to the same path.
- `uploadFile`/`link`: build the appropriate `AssetCreate*` from the
  convenience input. `productId` is mapped to
  `refIds: [{ type: "PRODUCT", id: productId }]`; `filename`/`mimeType` go
  into `details`; `access` defaults to `"PUBLIC"`.
- `attachToProduct`/`detachFromProduct`: `GET` the asset, add or remove the
  PRODUCT `refIds` entry idempotently, `PUT` it back. Returns the updated
  `Asset`.
- `listForProduct(productId)`: first tries server-side filtering via the
  Emporix `q` syntax on `refIds.id`; if the spec/server returns 400 for that
  filter, falls back to a client-side filter over the (paginated) list.
  Verified at implementation time.
- All return types are the generated types (or the documented `{ id }` for
  the 201 create response), per the project's
  [[generated-types-request-and-response]] memory.

Wired into `EmporixClient.media` (alongside `customers`, `products`, …).
Exposed via `@viu/emporix-sdk/media` subpath
(`{ types, import, require }` order, consistent with the rest).
`commitlint.config.js` gets a `media` scope.

### C. Remove `ProductService.media`

- Delete the `readonly media = { list: … }` block in
  `packages/sdk/src/services/product.ts` and its `import type { Media }`
  re-export usage if `Media` becomes unused. Keep the `Media` type alias if
  still referenced; remove if not.
- Remove the assertion `expect((await s().media.list("p1"))[0]?.url)…` in
  `packages/sdk/tests/services/facade-coverage.test.ts` (the only consumer).
- No example/react usage to update (verified — no other references).
- The `Media` export from `packages/sdk/src/index.ts` is dropped if removed.

### D. React `useProductMedia(productId)`

A thin convenience that derives from the existing `useProduct(productId)`:

```ts
export function useProductMedia(productId: string): {
  data: ProductMedia | undefined;
  isLoading: boolean;
  error: unknown;
}
```

No new network call, no service token in the browser. Implemented as a
selector over the existing product query. Exported from
`@viu/emporix-sdk-react` alongside the other product hooks.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `HttpClient` (extended) | Accept `FormData` bodies (no JSON-stringify, no Content-Type) | — |
| `MediaService.create` | POST `/media/{tenant}/assets` discriminated by `kind` (BLOB→FormData, LINK→JSON) | `http`, `auth`, generated `media` types |
| `MediaService` CRUD | list/get/update/remove on `/assets[/{id}]` | same |
| Convenience helpers | thin wrappers over CRUD (refIds + details) | `MediaService` |
| `useProductMedia` (react) | selector over `useProduct(productId).productMedia` | react-query, sdk |

## Error handling

- Reuse the `HttpClient` typed-error mapping (`EmporixAuthError`,
  `EmporixValidationError`, etc.). 4xx from media (missing scope, 413 file
  too large, 415 unsupported media-type, 404 unknown asset) propagates
  verbatim — no SDK-side masking.
- `attachToProduct` is idempotent: if the PRODUCT refId is already present,
  the PUT is a no-op write (still returns the current asset).

## Testing

- **SDK (msw):**
  - `HttpClient` FormData branch — focused unit test asserting no
    `Content-Type` header is sent and the body is the `FormData` instance.
  - `MediaService.create` BLOB — request `Content-Type` is multipart, the
    server receives the file part and the JSON `body` part; returns `{id}`.
  - `MediaService.create` LINK — request body is JSON `AssetCreateLink`;
    returns `{id}`.
  - `uploadFile` / `link` — refIds/details derived correctly from
    convenience input.
  - `attachToProduct` / `detachFromProduct` — GET → mutate → PUT; idempotent
    when entry already present/absent.
  - `listForProduct` — happy path with server-side filter; fallback path
    when the filter is rejected.
  - `list` / `get` / `update` / `remove` — request shape + return type.
  - Removal of `ProductService.media` — the now-deleted test is gone; the
    rest of `facade-coverage` still passes.
- **React (jsdom):** `useProductMedia` returns the product's `productMedia`
  array and tracks loading/error from the underlying product query.
- Coverage ≥80% on `packages/*` maintained.

## Release / docs

- Changeset: `@viu/emporix-sdk` **minor** (new MediaService, FormData
  HttpClient support, **BREAKING** removal of `ProductService.media`).
  `@viu/emporix-sdk-react` **minor** (new `useProductMedia` hook).
- New doc `docs/media.md`:
  - Canonical flows (BLOB upload vs LINK; attach via `refIds`; remove via
    `detachFromProduct` or `DELETE`).
  - Auth model: Media reads/writes are **service-token only**; storefronts
    read product media via `product.productMedia`.
  - YAGNI/out of scope note for `/download` and PRIVATE-asset retrieval.

## Plan decomposition

Cohesive enough for **one spec**; execution as **one phased plan**, branch
`feat/media-service` from `main`:

1. Vendor + generate `media` spec; record `plan-media-type-bindings.md`.
2. `HttpClient` FormData branch + focused test.
3. `MediaService` CRUD + `create` (BLOB + LINK) + tests + client wiring +
   `./media` subpath + `commitlint` scope.
4. Convenience helpers (`uploadFile`, `link`, `attachToProduct`,
   `detachFromProduct`, `listForProduct`) + tests.
5. Remove `ProductService.media` + adjust `facade-coverage` test +
   `index.ts` exports if `Media` becomes unused.
6. React `useProductMedia` + test.
7. `docs/media.md` + changeset + green gate + finish.

## Out of scope (YAGNI)

- `GET /assets/{id}/download` (PUBLIC redirect / PRIVATE bytes) — added
  later if a use case appears.
- Browser-side uploads from React (would require a BFF or a token-exchange
  step; not in this initiative).
- Bulk-create endpoints (not exposed by the Emporix spec).
- Authoring metadata not in the generated schema (alt text, priority — the
  Emporix media schema doesn't expose these; if needed in the future, they
  go in `customAttributes`).
