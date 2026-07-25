---
"@viu/emporix-sdk": minor
---

Complete the schema-service coverage in `client.schema`. New `schema.references`
sub-resource (`list`/`get`/`create`/`update`/`delete`) — create and update are
`multipart/form-data` uploads whose `file` part accepts a `Blob` or a plain
object (serialized to JSON). New instance bulk methods `bulkCreateInstances`,
`bulkUpsertInstances` and `bulkDeleteInstances` alongside the existing
`bulkPatchInstances`, plus `exportCustomEntities` / `importCustomEntities`.
Note: the OpenAPI schema declares no request body for the bulk delete, but its
description mandates an array of ids — the SDK follows the description and sends
one. All methods keep the service's service-token default.
