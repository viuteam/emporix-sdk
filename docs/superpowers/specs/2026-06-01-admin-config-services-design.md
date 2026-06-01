# Admin Config/Utility Services (Batch 1) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Batch 1 of the admin set: bind three small server-side services in one branch —
**SEPA Export** (`client.sepaExport`), **Indexing** (`client.indexing`), and
**Unit Handling** (`client.units`). ~20 operations total.

## Background

All three are OAuth2/service-token (no `CustomerAccessToken`) → core-SDK only,
no React. Standard tenant base paths. One quirk: **SEPA `getFile` returns a raw
`text/plain` file** (the SEPA XML), so it uses `HttpClient.requestRaw` and
returns a `string` (the `MediaService.download` pattern), not JSON.

## Design decisions

- **D1 — Scope:** full surface of each (sepa 3, indexing 8, unit-handling 9).
- **D2 — Three services, one branch:** `client.sepaExport`, `client.indexing`,
  `client.units`.
- **D3 — No React; service-token default, overridable.**
- **D4 — Types via codegen + aliasing.** SEPA `getFile` → `string` via
  `requestRaw`. Create responses are distinct (`JobId` / `IndexCreationResponse`
  / `CreateUnitResponse`); updates/deletes → `void` (pin at codegen). Unit
  conversion endpoints are PUT "command" calls (compute, not mutate).

## Public types (final names pinned at codegen)

- **SEPA:** `SepaJob` (`JobDetails`), `SepaJobInput` (`CreateJob`), `SepaJobCreated` (`JobId`).
- **Indexing:** `IndexConfig` (`IndexConfiguration`, read + write body),
  `IndexConfigCreated` (`IndexCreationResponse`), `IndexPublicConfig`
  (`IndexPublicConfiguration`), `ReindexInput` (`Reindex`).
- **Unit Handling:** `Unit`, `UnitInput` (`BaseUnit`), `UnitUpdate` (`UpdateUnit`),
  `UnitCreated` (`CreateUnitResponse`), `UnitTypeList` (`GET /types` response),
  `ConversionFactorInput`/`ConversionFactorResult`, `ConvertUnitInput`/`ConvertUnitResult`.

## Service surface

**`client.sepaExport`** (`/sepa-export/{tenant}`)
| Method | HTTP | Returns |
|---|---|---|
| `getFile(fileId, auth?)` | GET `/files/{fileId}` (raw text) | `string` |
| `listJobs(query?, auth?)` | GET `/jobs` | `SepaJob[]` |
| `createJob(input, auth?)` | POST `/jobs` | `SepaJobCreated` |

**`client.indexing`** (`/indexing/{tenant}`)
| Method | HTTP |
|---|---|
| `listConfigurations(auth?)` / `getConfiguration(provider, auth?)` | GET `/configurations[/{provider}]` |
| `createConfiguration(input, auth?)` | POST `/configurations` → `IndexConfigCreated` |
| `updateConfiguration(provider, input, auth?)` | PUT `/configurations/{provider}` |
| `deleteConfiguration(provider, auth?)` | DELETE `/configurations/{provider}` |
| `listPublicConfigurations(auth?)` / `getPublicConfiguration(provider, auth?)` | GET `/public/configurations[/{provider}]` |
| `reindex(input, auth?)` | POST `/reindex` |

**`client.units`** (`/unit-handling/{tenant}`)
| Method | HTTP |
|---|---|
| `listUnits(query?, auth?)` / `getUnit(unitCode, auth?)` | GET `/units[/{unitCode}]` |
| `createUnit(input, auth?)` | POST `/units` → `UnitCreated` |
| `updateUnit(unitCode, input, auth?)` | PUT `/units/{unitCode}` |
| `deleteUnit(unitCode, auth?)` | DELETE `/units/{unitCode}` |
| `deleteUnits(codes, auth?)` | DELETE `/units` (bulk; `codes` query) |
| `getConversionFactor(input, auth?)` | PUT `/units/conversion-factor-commands` → `ConversionFactorResult` |
| `convertUnit(input, auth?)` | PUT `/units/convert-unit-commands` → `ConvertUnitResult` |
| `listUnitTypes(auth?)` | GET `/types` → `UnitTypeList` |

Path segments `encodeURIComponent`-escaped. Update/delete/reindex response codes
(void vs body) and the `codes` bulk-delete param format pinned at codegen.

## Error handling

Shared `errorFromResponse` via `HttpClient`. SEPA `getFile` checks `res.ok` on
the raw response and throws `errorFromResponse` on non-2xx (mirrors `media.download`).

## Testing

Per service: `*-types.test.ts`, `*.test.ts` (MSW — token, paths, bodies, the raw
text getFile, `encodeURIComponent`, 404), one combined wiring test.

## Out of scope

Other admin services (Batches 2–5): catalog, vendor, pick-pack, customer-service,
client-management, approval.

## Deliverables

Codegen (3) + 3 type modules + 3 services + wiring (loggers `"sepa-export"`/
`"indexing"`/`"unit-handling"`, facades `src/{sepa-export,indexing,unit-handling}.ts`,
barrel) + `docs/{sepa-export,indexing,unit-handling}.md` + CLAUDE.md + changeset
(minor, `@viu/emporix-sdk` only). Branch `feat/admin-config-services` off `main`.
