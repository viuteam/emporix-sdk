---
"@viu/emporix-sdk": minor
---

feat(sdk): add media.patch and ai.reuseAttachment, and document the product mixin merge

Two endpoints Emporix changed on 2026-09-10, plus one undocumented contract that
turned up in the same sync.

- `client.media.patch(assetId, ops)` — the new `PATCH /media/{tenant}/assets/{assetId}`,
  an RFC-6902 op-array (`add`/`remove`/`replace`), resolving on `204`. This is the
  only way to change a `BLOB` asset's metadata **without re-uploading the file**:
  `update(assetId, { kind: "blob", … })` always replaces the bytes. Append to an
  array with a path ending in `/-` — `{ op: "add", path: "/refIds/-", value }`
  keeps the existing entries, while `/refIds` without the suffix replaces them
  all. `type` and `access` stay immutable, and a stale `metadata.version` still
  gets a `409`.
- `client.ai.reuseAttachment(agentId, attachmentId, { sessionId })` — the
  attachments endpoint now takes either a file or the id of an attachment already
  in the session, and **exactly one of the two**; both or neither is a `400`. A
  separate method rather than an overload, because the two branches disagree on
  more than the input: the upload answers `201` with `{ id, sessionId }` while the
  reuse answers `204` and returns nothing, and `session-id` is optional on the
  upload but required on the reuse — the attachment id is resolved inside that
  session, so omitting it cannot succeed.

`AGENT` joined the media reference types (`RefId.type`), which links a `PRIVATE`
asset to an AI agent. Nothing was needed for it — `AssetRefId` aliases the
generated type, so it arrived with the sync.

**The product service also drifted, with no schema change and no changelog entry
upstream**, and what it added is worth knowing because it is easy to get
backwards: `products.update` (`PATCH`) **merges** mixins. An omitted mixin name
stays on the product, sent fields merge recursively, and `null` stores `null`
instead of deleting. There is therefore no way to delete a mixin through `PATCH`
— that needs `products.replace` with `partial: false` and a complete document
that omits the mixin from both `mixins` and `metadata.mixins`. And despite the
verb, product `PATCH` is **not** a JSON-Patch endpoint; an op-array is rejected.
Both are now in the JSDoc of the two methods.
