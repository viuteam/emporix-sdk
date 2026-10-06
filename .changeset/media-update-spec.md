---
"@viu/emporix-sdk": minor
---

Align `media.update` and the helpers built on it with the Media spec.

- **`attachToProduct` / `detachFromProduct` follow the spec** (checked against the spec, not a live tenant). They sent a JSON `PUT` of `{ type, refIds }`, which the spec rejects for both asset types: a BLOB takes no JSON `PUT`, and a LINK's requires `access` and `url`. They now send a JSON Patch that touches only `refIds` (`add /refIds/-`, `replace /refIds`) and still resolve to the asset, with the change applied.
- **Type change — `update()` and `replaceFile()` resolve to `void`.** The `PUT` answers `204` with no body, so they always resolved to `undefined` at runtime despite promising an `Asset`. Code that read the result was already broken; it now fails to compile instead.
- **Type change — the JSON body of `update()` is `AssetUpdateLinkInput`.** The spec takes JSON only for a LINK asset. A BLOB is replaced with `{ kind: "blob", file, body }` (or `replaceFile()`), and its metadata alone is changed with `patch()`. `AssetUpdateInput` stays exported but is deprecated.

Both type changes only affect code that, per the spec, did not work before — hence a minor rather than a major.
