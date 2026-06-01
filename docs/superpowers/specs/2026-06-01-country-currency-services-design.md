# Country + Currency Services Binding — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Bind the Emporix **Country Service** and **Currency Service** as two server-side
services, `client.countries` and `client.currencies`, in one branch/PR. They
provide the country/region and currency/exchange-rate master data a storefront
and checkout build on.

## Background

Both are OAuth2/service-token services (no `CustomerAccessToken`) → core-SDK
only, no React. Standard tenant base paths (`/country/{tenant}/…`,
`/currency/{tenant}/…`). Reads (`*_read`) may be granted to anonymous tokens, but
the SDK defaults to the service token (overridable).

## Design decisions

- **D1 — Scope:** Full coverage of both services. Country has no create/delete
  (countries are predefined — list/get/patch + regions list/get). Currency has
  full CRUD on currencies **and** exchange rates. (User-selected.)
- **D2 — Two services, one branch:** `CountryService` → `client.countries`,
  `CurrencyService` → `client.currencies`. (User-selected.)
- **D3 — No React:** service-token only. (User-selected.)
- **D4 — Service-token default:** every method defaults `auth` to
  `{ kind: "service" }`, overridable (`auth.anonymous()` for storefront reads).
- **D5 — Types via codegen + aliasing:** add `country-service` + `currency-service`
  to `fetch-specs.ts`; alias the generated types. Final names + list-envelope-vs-array
  + create/update/delete response shapes pinned at codegen.

## Public types (final names pinned in codegen)

- **Country:** `Country` (read), `CountryList` (`GetCountries`), `CountryUpdate`
  (PATCH = `countryUpdate`); `Region` (read), `RegionList` (`GetRegions`).
- **Currency:** `Currency` (read = `currencyRetrieval`), `CurrencyList`,
  `CurrencyInput` (`currencyCreation`), `CurrencyUpdate` (`currencyUpdate`),
  `CurrencyCreated` (`currencyCreationResponse`); `ExchangeRate`
  (`exchangeRateRetrieval`), `ExchangeRateList`, `ExchangeRateInput`
  (`exchangeRateCreationRequest`), `ExchangeRateUpdate` (`exchangeRateUpdateRequest`),
  `ExchangeRateCreated` (`exchangeRateResponse`).

## Service surface

| `client.countries` | HTTP | Path |
|---|---|---|
| `listCountries(query?, auth?)` | GET | `/country/{tenant}/countries` |
| `getCountry(countryCode, auth?)` | GET | `/country/{tenant}/countries/{code}` |
| `patchCountry(countryCode, patch, auth?)` | PATCH | `/country/{tenant}/countries/{code}` |
| `listRegions(query?, auth?)` | GET | `/country/{tenant}/regions` |
| `getRegion(regionCode, auth?)` | GET | `/country/{tenant}/regions/{code}` |

| `client.currencies` | HTTP | Path |
|---|---|---|
| `listCurrencies(query?, auth?)` | GET | `/currency/{tenant}/currencies` |
| `getCurrency(code, auth?)` | GET | `/currency/{tenant}/currencies/{code}` |
| `createCurrency(input, auth?)` | POST | `/currency/{tenant}/currencies` |
| `updateCurrency(code, input, auth?)` | PUT | `/currency/{tenant}/currencies/{code}` |
| `deleteCurrency(code, auth?)` | DELETE | `/currency/{tenant}/currencies/{code}` |
| `listExchangeRates(query?, auth?)` | GET | `/currency/{tenant}/exchanges` |
| `getExchangeRate(code, auth?)` | GET | `/currency/{tenant}/exchanges/{code}` |
| `createExchangeRate(input, auth?)` | POST | `/currency/{tenant}/exchanges` |
| `updateExchangeRate(code, input, auth?)` | PUT | `/currency/{tenant}/exchanges/{code}` |
| `deleteExchangeRate(code, auth?)` | DELETE | `/currency/{tenant}/exchanges/{code}` |

Path codes (`countryCode`/`regionCode`/`code`) are `encodeURIComponent`-escaped.
Exact create/update/delete response shapes pinned at codegen.

## Error handling

Shared `errorFromResponse` via `HttpClient`. No service-specific errors.

## Testing

- **Core (Vitest + MSW):** `country-types.test.ts`/`currency-types.test.ts`,
  `country.test.ts`/`currency.test.ts` (each method: `Bearer svc-tok`, the
  tenant paths, bodies, `encodeURIComponent`, 404), one combined
  `country-currency-wiring.test.ts`.

## Out of scope

Nothing within either service is deferred. No React.

## Deliverables

Codegen (both) + `country-types.ts`/`currency-types.ts` +
`CountryService`/`CurrencyService` + wiring (loggers `"country"`/`"currency"`,
facades `src/country.ts`/`src/currency.ts`, barrel) + `docs/country.md`/`docs/currency.md`
+ CLAUDE.md + changeset (minor, `@viu/emporix-sdk` only). Branch
`feat/country-currency-services` off `main`.
