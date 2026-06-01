---
"@viu/emporix-sdk": minor
---

Add Emporix AI Service bindings via `client.ai`: text generation
(`generateText`), chat completions (`complete`), agent CRUD (`listAgents`,
`getAgent`, `upsertAgent`, `patchAgent`, `deleteAgent`, `searchAgents`), and
synchronous / asynchronous agentic chat (`chat`, `chatAsync`). Server-side only
— these use the service (clientCredentials) token and must not be called from a
browser; both chat endpoints return arrays. Templates, import/export,
logs/sessions and tokens are not yet bound.
