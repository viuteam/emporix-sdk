---
"@viu/emporix-sdk": minor
---

Add Schema Service bindings: `client.schemas` provides CRUD over schemas
(`listSchemas`/`getSchema`/`createSchema`/`updateSchema`/`deleteSchema`) plus
`validateSchemaFile`, entity types (`listTypes`/`setSchemaTypes`), custom
entities (`listCustomEntities`/`getCustomEntity`/`createCustomEntity`/
`updateCustomEntity`/`deleteCustomEntity`), and custom instances
(`listInstances`/`getInstance`/`createInstance`/`replaceInstance`/
`patchInstance`/`deleteInstance`/`searchInstances`). Server-side only — these
use the service (clientCredentials) token and must not be called from a
browser. References, export/import and bulk instance ops are not yet exposed.
