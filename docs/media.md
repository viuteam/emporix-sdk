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
details: { filename, mimeType } }`. The 201 response is `{ id }`. The file may
be up to 30 MB; a [direct upload](#direct-upload) sends it straight to storage
instead.

## Direct upload

`startUploadSession()` sends the file straight to storage: Emporix creates the
asset as `PENDING` and answers with the request to make, and the Media API never
sees the bytes. That request needs no Emporix token, so the server can start the
session and hand the upload to a browser.

```ts
const session = await client.media.startUploadSession({
  type: "BLOB",
  access: "PRIVATE",
  details: { filename: "installation-guide.pdf", mimeType: "application/pdf" },
});

// Anywhere, including a browser — no Emporix token involved.
const { method, url, headers, fields } = session.upload;
if (method === "PUT") {
  await fetch(url, { method, headers, body: file });
} else {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields ?? {})) form.append(key, value);
  form.append("file", file); // the file part goes last
  await fetch(url, { method, body: form });
}
// session.id is the asset id.
```

| `access` | `uploadType` | `upload.method` | Send |
|---|---|---|---|
| `PRIVATE` | `put` (default) | `PUT` | the file as the body, with every `upload.headers` entry |
| `PRIVATE` | `form` | `POST` | multipart: every `upload.fields` entry unchanged, the file last |
| `PUBLIC` | ignored | `POST` | the same, to Cloudinary |

The asset's `status` stays `PENDING` until storage confirms the file, then turns
`READY` — assets created by `create()` or `uploadFile()` carry no `status`.
Until then, calls that need the file answer `409`. The upload request is valid
for 15 minutes (Google Cloud Storage) or an hour (Cloudinary); an unused session
expires at `session.expiresAt` and is cleaned up.

Direct upload is enabled per tenant by Emporix Support. Without it,
`startUploadSession()` throws an `EmporixForbiddenError` whose `body.message` is
`direct upload is not enabled for this tenant`, and nothing is created — a
missing scope is a `403` too, so read the message.

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

Both read the asset, then send a JSON Patch that touches only `refIds` (`add
/refIds/-` to attach, `replace /refIds` to detach), so they work for BLOB and
LINK assets alike. They resolve to the asset as read back after the patch.
Earlier versions sent a JSON `PUT` of `{ type, refIds }` instead, which the spec
rejects for either type.

What the live API adds to the spec (measured on 2026-10-06):

- **Only a `PUBLIC` asset takes a product reference.** A `PRIVATE` one answers
  `400` «Cannot assign media of private access to other entity»; private assets
  are documented for `AGENT` references.
- **A reference to a product that does not exist is dropped without an error.**
  Creating such an asset answers `404`, but the `PATCH` answers `204` and leaves
  the reference out. That is why both helpers return the asset as read back:
  check its `refIds` rather than trusting the call.
- **An empty `refIds` array is not returned** — after the last reference is
  detached, `refIds` is absent from the asset.

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

## Download URL

Emporix recommends this for every download: the file goes from storage to the
client without passing through the Media API, there is no size limit, and the
URL can be handed to a browser as it is.

```ts
const { provider, url, expiresAt } = await client.media.getDownloadUrl(assetId);

// a private file the browser should display rather than save
await client.media.getDownloadUrl(assetId, { disposition: "inline" });
```

| `provider` | Asset | `url` |
|---|---|---|
| `GCS` | `PRIVATE` BLOB | signed; works without an Emporix token until `expiresAt` (15 minutes by default) |
| `CLOUDINARY` | `PUBLIC` BLOB | permanent |
| `LINK` | `LINK` | the stored URL |

`disposition` (`attachment` by default, or `inline`) changes private URLs only.
The call needs `media.asset_read`, so it runs on the server; the URL it returns
is what goes to the browser. It works whether or not [direct
upload](#direct-upload) is enabled. A `409` means a direct upload is still
`PENDING` and its file has not reached storage.

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

Prefer the [download URL](#download-url): here the file passes through the Media
API, which answers `413` once the asset's known size exceeds the streaming limit
(30 MB by default) and `409` while a direct upload is still `PENDING`.

**Browser limitation**: `download()` uses `redirect: "manual"` to capture
the `Location` header. In Node this works. In a browser the redirect
location is hidden by the fetch spec — `PUBLIC` downloads throw. Browser
code should render a URL from `getDownloadUrl()`, fetched on the server,
via `<img>` / `<a download>`.

## Replace the bytes of an existing BLOB asset

```ts
await client.media.replaceFile(assetId, {
  file: newBytes,
  access: "PUBLIC",                 // immutable on the server — must match
  filename: "hero-v2.jpg",
  mimeType: "image/jpeg",
  version: asset.metadata?.version, // optimistic locking; read for you when omitted
});
```

`replaceFile()` is sugar over `update(assetId, { kind: "blob", file, body })`
that builds the `AssetUpdateBlob` body from the input. Use this instead of
`remove` + `create` so the asset id (and all `refIds` pointing to it) stay
stable. It resolves to nothing: the `PUT` answers `204`.

**Every update needs `metadata.version`.** The spec marks `metadata` optional;
the live API answers `400` «`metadata.version` is required for update» without
it, for BLOB and LINK alike, and `409` for a stale one. `update()` therefore
requires it in the body type. `replaceFile()` reads the current version when you
pass none — the write then wins over any change in between; pass `version` when
that matters.

## Replace a LINK asset (`PUT`)

The spec takes one `PUT` body per asset type. A LINK asset is replaced with
JSON, and the body is the whole asset — `type`, `access` and `url` are required:

```ts
await client.media.update(assetId, {
  kind: "json",
  body: {
    type: "LINK",                   // immutable — must match the existing asset
    access: "PUBLIC",               // immutable — must match
    url: "https://example.com/spec-sheet-v2.pdf",
    metadata: { version: asset.metadata?.version ?? 1 },
  },
});
```

A BLOB asset is replaced with `{ kind: "blob", file, body }` (or the
`replaceFile()` sugar above): file and body are both required, so the bytes are
always replaced. A BLOB's metadata alone goes through `patch()` below. `update()`
resolves to nothing — the `PUT` answers `204`. Earlier versions also took a BLOB
as the JSON body and promised the updated asset in return; the spec allows
neither.

## Patch a single field (`PATCH`, RFC-6902)

`patch()` changes one field without resending the whole asset, and is the only
way to touch a BLOB asset's metadata **without re-uploading the file** —
`update(…, { kind: "blob" })` always replaces the bytes. Resolves on `204`.

```ts
await client.media.patch(assetId, [
  { op: "add", path: "/refIds/-", value: { id: "product1", type: "PRODUCT" } },
  { op: "replace", path: "/url", value: "https://emporix.io/docs/index.html" },
]);
```

The `/-` suffix appends and keeps the existing entries — writing `/refIds`
without it replaces the whole array. Only `add`, `remove` and `replace` are
accepted; `type` and `access` stay immutable here as well, and a stale
`metadata.version` still gets a `409`.

Reference types are `BRAND`, `CATEGORY`, `LABEL`, `PRODUCT`, `MODULE`, `AGENT`
or any custom schema type. `AGENT` is what links a `PRIVATE` asset to an AI
agent — see [`ai.md`](./ai.md).

## Out of scope

- Browser-side uploads through the Media API — they need a server-side
  token-exchange step (in Next, see `@viu/emporix-sdk-next/session`). A [direct
  upload](#direct-upload) needs only the session the server starts.
- Bulk operations — Emporix Media has no batch endpoint (unlike
  `cart.itemsBatch`). Loops over `create` / `update` are the only path.
