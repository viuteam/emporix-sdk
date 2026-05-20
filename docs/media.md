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
const assets = await client.media.listForProduct(productId);
```

For the storefront read path, prefer `useProductMedia(productId)` or the
`product.productMedia` field on `client.products.get(productId)`.

## Out of scope

- `GET /assets/{id}/download` (PUBLIC redirect / PRIVATE bytes) — caller
  can use `asset.url` for PUBLIC assets or fetch the endpoint directly.
- Browser-side uploads — would require a BFF / token-exchange step.
