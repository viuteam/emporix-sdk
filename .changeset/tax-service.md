---
"@viu/emporix-sdk": minor
---

Add Emporix Tax Service bindings via `client.taxes`: CRUD over per-location tax
configurations (`listTaxConfigs`, `getTaxConfig`, `createTaxConfig`,
`updateTaxConfig`, `deleteTaxConfig`) and net/gross tax calculation
(`calculateTax`). Server-side only — these use the service (clientCredentials)
token and must not be called from a browser.
