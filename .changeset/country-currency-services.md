---
"@viu/emporix-sdk": minor
---

Add Emporix Country and Currency Service bindings via `client.countries`
(countries + regions: `listCountries`/`getCountry`/`patchCountry`/`listRegions`/
`getRegion`) and `client.currencies` (currencies + exchange rates: full CRUD on
both). Server-side only — these use the service (clientCredentials) token.
