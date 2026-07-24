---
"@viu/emporix-sdk": minor
---

Derive `SiteService` and `SessionContextService` public types from the
generated `site-settings-service` / `session-context` types. `Site` now
inherits every generated field (shipping/payment/tax/assistedBuying/mixins/
taxDeterminationBasedOn, richer address) while keeping `active`/`default`
required; `SessionContext.sessionId` stays required and the ergonomic flat
`patch({ …, version })` DX is unchanged. Note: `SessionContext.context` /
`SessionContextPatch.context` are now the accurate nested map type
(`Record<string, Record<string, unknown>>`) instead of `Record<string, unknown>`.
