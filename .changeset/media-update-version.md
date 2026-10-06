---
"@viu/emporix-sdk": minor
---

Follow what the live Media API requires on top of the spec, found by running the facade against a tenant.

- **Type change — `update()` requires `metadata.version`** in both bodies (`AssetUpdateLinkInput`, `AssetUpdateBlobInput`). The spec marks it optional, but the API answers `400` «`metadata.version` is required for update» without it.
- **`replaceFile()` works without a `version`.** It sent none and got that `400`; it now reads the current version first. Pass `version` for optimistic locking (a stale one gets a `409`).
- **`attachToProduct` / `detachFromProduct` return the asset as read back after the patch.** The API answers `204` to a reference to a product that does not exist and drops it, so the locally computed result could claim an attachment that never happened.
