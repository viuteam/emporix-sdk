---
"@viu/emporix-sdk": minor
---

Add `client.media.download(assetId, auth?)` for retrieving asset content via `GET /media/{tenant}/assets/{id}/download`. Returns a discriminated union:

- `{ kind: "redirect", url }` for `PUBLIC` assets — the SDK captures the server's 30x `Location` header so the caller can redirect the user to the storage URL without proxying bytes.
- `{ kind: "bytes", data, etag?, contentType? }` for `PRIVATE` assets — the SDK returns the response body as an `ArrayBuffer`. When the server uses the OpenAPI-documented `text/plain` + base64 wire format, the SDK decodes it transparently; binary content types are passed through.

Also adds a low-level `HttpClient.requestRaw` escape hatch (used internally by `download`) for endpoints whose responses are not JSON. Auth resolution + timeout + logging are applied; the retry-on-5xx and 401-reauth-once paths from `request` are intentionally skipped (callers of `requestRaw` handle their own response shape).

Browser note: `download()` uses `redirect: "manual"` so it can observe `PUBLIC` redirect URLs. In Node this works as documented; in a browser the redirect `Location` is hidden by the fetch spec — there, `PUBLIC` downloads will surface as an error. Browser code should use the asset's `url` field (for `LINK` assets) or render `PUBLIC` `BLOB` assets via the storage URL directly.
