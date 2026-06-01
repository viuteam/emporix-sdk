---
"@viu/emporix-sdk": minor
---

Add Webhook Service bindings: `client.webhooks` provides the event-subscription
catalog + batch toggle (`listEventSubscriptions` / `updateEventSubscriptions`),
delivery-config CRUD (`listConfigs` / `getConfig` / `createConfig` /
`replaceConfig` / `patchConfig` / `deleteConfig`), `getStatistics`, and
`getDashboardAccess`. `updateEventSubscriptions` returns the HTTP-207 per-item
result array so callers can handle partial failures; `patchConfig` takes the
op-based (`UPSERT`/`REMOVE`) update array. Server-side only — these use the
service (clientCredentials) token and must not be called from a browser.
