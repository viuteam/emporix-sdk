---
"@viu/emporix-sdk": major
---

Add `client.media.download(assetId, auth?)` for retrieving asset content via `GET /media/{tenant}/assets/{id}/download`. Returns a discriminated union:

- `{ kind: "redirect", url }` for `PUBLIC` assets — the SDK captures the server's 30x `Location` header so the caller can redirect the user to the storage URL without proxying bytes.
- `{ kind: "bytes", data, etag?, contentType? }` for `PRIVATE` assets — the SDK returns the response body as an `ArrayBuffer`. When the server uses the OpenAPI-documented `text/plain` + base64 wire format, the SDK decodes it transparently; binary content types are passed through.

Also adds a low-level `HttpClient.requestRaw` escape hatch (used internally by `download`) for endpoints whose responses are not JSON. Auth resolution + timeout + logging are applied; the retry-on-5xx and 401-reauth-once paths from `request` are intentionally skipped (callers of `requestRaw` handle their own response shape).

Browser note: `download()` uses `redirect: "manual"` so it can observe `PUBLIC` redirect URLs. In Node this works as documented; in a browser the redirect `Location` is hidden by the fetch spec — there, `PUBLIC` downloads will surface as an error. Browser code should use the asset's `url` field (for `LINK` assets) or render `PUBLIC` `BLOB` assets via the storage URL directly.

**Breaking — `media.list()`** now returns `PaginatedItems<Asset>` instead of `Asset[]`. Callers must read `.items` for the array. The new shape includes `pageNumber`, `pageSize`, and the standard `hasNextPage` heuristic so paginated listings behave like every other list endpoint in the SDK. The previous shape silently truncated at the server-default page size (60); the new shape makes pagination explicit.

  ```ts
  // before
  const assets = await client.media.list();        // Asset[], page 1 only
  // after
  const { items, hasNextPage } = await client.media.list({ pageSize: 100 });
  ```

  `client.media.listForProduct(productId)` shares the same envelope change.

**Breaking — `media.update()`** now takes a discriminated input matching `create()`:

  ```ts
  // before
  await client.media.update(id, patch);
  // after — JSON path (refIds, details, url, metadata)
  await client.media.update(id, { kind: "json", body: patch });
  // after — BLOB file-replacement (multipart, up to 10MB)
  await client.media.update(id, { kind: "blob", file, body });
  ```

  The previous signature only supported the JSON path; the new BLOB path closes the gap where re-uploading bytes required `remove` + `create` (and lost the asset id). A new `client.media.replaceFile(assetId, { file, access, ... })` sugar wraps the common case.

New named type exports: `AssetUpdateBlobInput`, `AssetUpdateLinkInput`, `ListAssetsQuery`.
