---
"@viu/emporix-sdk": patch
---

Register the five remaining Emporix OpenAPI specs that were missing from the
fetch registry — `oauth-service`, `site-settings-service`, `invoice`, `quote`,
`session-context` — so the SDK vendors and generates types for all 43 listed
API services. Generated types only; no new service facades.
