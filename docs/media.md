# Media

Emporix's Media service stores assets (binary files or external URLs) and
attaches them to resources (products, categories, brands…) via a single
`refIds` array on the asset itself. There is no `/products/{id}/media`
endpoint — association lives in the Media service.

## Auth model

All Media-service endpoints require a service-only scope
(`media.asset_manage` for writes, `media.asset_read` for reads). The SDK
defaults every Media call to a `service` `AuthContext`; storefronts running
in a browser cannot call the Media service directly. The product GET
response includes a read-only denormalized `productMedia` array — that is
the storefront's read path, and `useProductMedia(productId)` exposes it
without an extra network call.

## Upload a binary file and attach it to a product

```ts
const { id } = await client.media.uploadFile({
  file,                       // a Blob/File
  productId: "<productId>",
  filename: "hero.jpg",
  mimeType: "image/jpeg",
});
```

This sends `POST /media/{tenant}/assets` as `multipart/form-data` with the
file in the `file` part and a JSON `body` part carrying
`{ type: "BLOB", access: "PUBLIC", refIds: [{ type: "PRODUCT", id }],
details: { filename, mimeType } }`. The 201 response is `{ id }`.

## Link an external URL

```ts
const { id } = await client.media.link({
  url: "https://cdn.example/i.jpg",
  productId: "<productId>",
});
```

Sends `POST /media/{tenant}/assets` as JSON with
`{ type: "LINK", access: "PUBLIC", url, refIds: [...] }`.

## Attach / detach later

```ts
await client.media.attachToProduct(assetId, productId);   // idempotent
await client.media.detachFromProduct(assetId, productId); // no-op if absent
```

## List media for a product (admin/server)

```ts
const { items, hasNextPage, pageNumber, pageSize } =
  await client.media.listForProduct(productId);
```

`list()` and `listForProduct()` return the shared `PaginatedItems<Asset>`
envelope (same shape as `products.list`, `categories.list`, etc.). The
server's default page size is 60; pass `{ pageSize, pageNumber }` to walk
beyond that. `hasNextPage` is `true` when the returned page is full
(`items.length === pageSize`) — paginate until it becomes `false`.

For the storefront read path, prefer `useProductMedia(productId)` or the
`product.productMedia` field on `client.products.get(productId)` — the
Media-service read scope is server-only.

## Download

```ts
const result = await client.media.download(assetId);

if (result.kind === "redirect") {
  // PUBLIC asset — Emporix returns a 30x with the storage URL.
  return Response.redirect(result.url);
}
// PRIVATE asset — bytes are returned in result.data (ArrayBuffer).
return new Response(result.data, {
  headers: {
    ...(result.contentType ? { "Content-Type": result.contentType } : {}),
    ...(result.etag ? { ETag: result.etag } : {}),
  },
});
```

`PUBLIC` assets resolve to `{ kind: "redirect", url }` (storage URL from the
server's `Location` header). `PRIVATE` assets resolve to `{ kind: "bytes",
data, etag?, contentType? }`. The SDK transparently decodes the
OpenAPI-documented `text/plain` + base64 wire format into an
`ArrayBuffer`; binary content-types pass through verbatim.

**Browser limitation**: `download()` uses `redirect: "manual"` to capture
the `Location` header. In Node this works. In a browser the redirect
location is hidden by the fetch spec — `PUBLIC` downloads throw. Browser
code should use the asset's `url` field (for `LINK` assets) or render the
storage URL directly via `<img>` / `<a download>`.

## Replace the bytes of an existing BLOB asset

```ts
await client.media.replaceFile(assetId, {
  file: newBytes,
  access: "PUBLIC",                 // immutable on the server — must match
  filename: "hero-v2.jpg",
  mimeType: "image/jpeg",
  version: asset.metadata?.version, // optional optimistic-locking
});
```

`replaceFile()` is sugar over `update(assetId, { kind: "blob", file, body })`
that builds the `AssetUpdateBlob` body from the input. Use this instead of
`remove` + `create` so the asset id (and all `refIds` pointing to it) stay
stable.

## Update an asset (metadata-only)

```ts
await client.media.update(assetId, {
  kind: "json",
  body: {
    type: "BLOB",                   // immutable — must match the existing asset
    access: "PUBLIC",               // immutable — must match
    details: { filename: "renamed.jpg" },
    metadata: { version: asset.metadata?.version ?? 1 },
  },
});
```

For BLOB file-replacement use `{ kind: "blob", file, body }` (or the
`replaceFile()` sugar above). The discriminated input mirrors `create()`.

## Out of scope

- Browser-side uploads — would require a BFF / token-exchange step.
- Bulk operations — Emporix Media has no batch endpoint (unlike
  `cart.itemsBatch`). Loops over `create` / `update` are the only path.
