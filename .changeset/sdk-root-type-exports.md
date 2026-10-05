---
"@viu/emporix-sdk": patch
---

Export from the package root every type a public method takes or returns. These were reachable only through a subpath or not at all, so a call like `imports.getLicense()` returned an `ImportLicense` that could not be named: `ImportStats`, `ImportStatsQuery`, `ImportJobGroup`, `ImportHealthThresholds`, `ImportLicense`, `LegalEntitySearchInput`, `QuoteReasonsResource`, `CustomerTokenValidation`, `CartItemBatchEntry`, `CartItemsBatchResponse`, `SegmentGroup`, `SegmentGroupInput`, `SessionContextData`, `SiteAddress`, `SiteHomeBase`, and the AI sub-resources `AgenticCrudResource`, `JobsResource`, `TemplatesResource`, `LogsResource` and `AnalyticsResource`. Type-only; no runtime change.
