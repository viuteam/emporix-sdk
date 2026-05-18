---
"@viu/emporix-sdk": minor
---

Fix `CustomerService.login` wire mapping. The Emporix `CustomerToken` response
is snake_case (`access_token`, `saas_token`, `refresh_token`, `session_id`,
`expires_in`); the camelCase variants are deprecated in the spec and may be
absent on real tenants, so the previous camelCase-only mapping returned
`undefined` tokens. Mapping is now snake_case-first with a camelCase fallback,
and `CustomerSession` additionally exposes `sessionId` and `expiresIn`. The
`saasToken` (JWT) is documented as required for the checkout `saas-token`
header.
