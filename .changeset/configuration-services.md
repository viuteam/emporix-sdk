---
"@viu/emporix-sdk": minor
---

Add Configuration Service bindings: `client.tenantConfig` and
`client.clientConfig` provide full CRUD (`list`/`get`/`create`/`update`/`delete`)
over tenant-wide and per-client configuration. Server-side only — these use the
service (clientCredentials) token and must not be called from a browser.
