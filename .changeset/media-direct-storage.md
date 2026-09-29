---
"@viu/emporix-sdk": minor
---

feat(media): add getDownloadUrl and startUploadSession for direct storage transfers

`client.media.getDownloadUrl(assetId, { disposition? })` returns a URL that serves the file straight from storage — signed for 15 minutes for a private asset, permanent for a public one — with no size limit and no Emporix token needed to open it. Emporix now recommends it over `download()`, which answers `413` once a file exceeds 30 MB.

`client.media.startUploadSession(input)` creates a `PENDING` asset and returns the storage request to send the file with, which a browser can make without an Emporix token. Direct upload has to be enabled for the tenant by Emporix Support; until then the call throws a `403` whose message is `direct upload is not enabled for this tenant`.

`AssetDownloadUrl`, `AssetDownloadUrlQuery`, `AssetUploadSession` and `AssetUploadSessionInput` are exported from the package root, and so is `AssetPatch`, which was missing there.
