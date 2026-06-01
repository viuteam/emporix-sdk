---
"@viu/emporix-sdk": minor
---

Add Sequential ID Service binding: `client.sequentialIds` provides sequence
schema admin (`listSchemas`/`getSchema`/`createSchema`/`deleteSchema`/
`setActiveSchema`/`listSchemasByType`) and id generation (`nextId`,
`nextIdsBatch`). Server-side only — these use the service (clientCredentials)
token and must not be called from a browser.
