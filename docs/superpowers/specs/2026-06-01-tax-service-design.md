# Tax Service Binding — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Package:** `@viu/emporix-sdk` (core only — no React binding)

## Summary

Bind the Emporix **Tax Service** (`/tax/{tenant}/…`) into the SDK as a single
server-side service, `client.taxes`, covering full CRUD over per-location tax
configurations plus the net/gross tax-calculation command. Follows the
established admin-service "configuration pattern" (service/clientCredentials
token by default, types generated via `@hey-api/openapi-ts`, thin public-types
re-export module).

## Background

The Tax Service is one of the upstream `api-references` specs not yet bound in
the SDK. Every endpoint is secured with **OAuth2 clientCredentials**
(`tax.tax_read` / `tax.tax_manage`) — there is no `CustomerAccessToken` flow —
so it is a server-side/admin API. This mirrors Fee, Webhook, Schema, etc.

## Design decisions

- **D1 — Scope:** Full. All six operations are bound: list / get / create /
  update / delete tax configurations, plus the `calculation-commands` tax
  calculation. (User-selected "Voll: CRUD + calculate".)
- **D2 — No React:** Service-token only; nothing in the spec accepts a customer
  or anonymous token, so there is no storefront use and no React hook. Consistent
  with the directive that Shopping List is the only service with React bindings.
- **D3 — One service:** A single `TaxService` exposed as `client.taxes`.
- **D4 — Method names:** `listTaxConfigs`, `getTaxConfig`, `createTaxConfig`,
  `updateTaxConfig`, `deleteTaxConfig`, `calculateTax`.
- **D5 — Types via codegen:** Add `tax-service` to `fetch-specs.ts`; generate
  `src/generated/tax-service/`. A thin `src/services/tax-types.ts` re-exports
  stable public names over the generated ones (insulating callers from the
  unstable upstream version). Real generated names are pinned during codegen
  (Task 1) — the upstream `components.schemas` keys are
  `taxCreation` / `taxRetrieval` / `taxUpdate` / `taxCreationResponse` /
  `taxClass` / `taxCalculationRequest` / `taxCalculationResponse`, but hey-api
  may rename; verify and alias.
- **D6 — Service-token default:** Every method defaults `auth` to
  `{ kind: "service" }`, overridable via a trailing `auth` argument.
- **D7 — Response-shape quirks (verify in codegen):**
  - `POST /taxes` returns **`{ locationCode }`** (`taxCreationResponse`), NOT the
    full configuration. Public return type `TaxConfigCreated`.
  - `calculateTax` is **single** request → single response (the path is
    `calculation-commands` but the body/response are single objects, not arrays).
  - `updateTaxConfig` requires `metadata.version` (optimistic locking) — surface
    it on the input type; confirm whether PUT returns the config or 204 during
    codegen.
  - `DELETE` resolves to `void` (204).

## Public types (target shapes — final names pinned in codegen)

```ts
// One tax class within a configuration.
interface TaxClass {
  code: string;
  name?: string | Record<string, string>;        // localized or plain
  description?: string | Record<string, string>;
  order?: number;
  rate?: number;
  isDefault?: boolean;
}

// Read shape (GET list/one) — taxRetrieval.
interface TaxConfig {
  locationCode: string;
  location?: { countryCode: string; /* … */ };
  taxClasses: TaxClass[];
  metadata?: { version?: number; createdAt?: string; modifiedAt?: string };
}

// Write shape (POST/PUT) — taxCreation/taxUpdate.
interface TaxConfigInput {
  location: { countryCode: string; /* … */ };
  taxClasses: TaxClass[];
  metadata?: { version?: number };               // version required on update
}

// POST response — taxCreationResponse.
interface TaxConfigCreated { locationCode: string }

// Calculation — taxCalculationRequest / taxCalculationResponse.
interface TaxCalculationInput {
  sourceLocation?: { countryCode: string };
  sourceTaxClass?: string;
  targetLocation: { countryCode: string };
  targetTaxClass?: string;
  includesTax?: boolean;
  price: number;
}
interface TaxCalculationRequest { commandUuid?: string; input: TaxCalculationInput }
interface TaxCalculationResult {
  commandUuid?: string;
  input?: TaxCalculationInput;
  output?: { net?: number; gross?: number; tax?: number; appliedRate?: number };
}
```

## Service surface

| Method | HTTP | Path | Returns |
|---|---|---|---|
| `listTaxConfigs(auth?)` | GET | `/tax/{tenant}/taxes` | `TaxConfig[]` |
| `getTaxConfig(locationCode, auth?)` | GET | `/tax/{tenant}/taxes/{locationCode}` | `TaxConfig` |
| `createTaxConfig(input, auth?)` | POST | `/tax/{tenant}/taxes` | `TaxConfigCreated` |
| `updateTaxConfig(locationCode, input, auth?)` | PUT | `/tax/{tenant}/taxes/{locationCode}` | `TaxConfig` \| `void` |
| `deleteTaxConfig(locationCode, auth?)` | DELETE | `/tax/{tenant}/taxes/{locationCode}` | `void` |
| `calculateTax(request, auth?)` | PUT | `/tax/{tenant}/taxes/calculation-commands` | `TaxCalculationResult` |

`locationCode` is `encodeURIComponent`-escaped in the path.

## Error handling

Reuses the SDK's `errorFromResponse` mapping (`EmporixNotFoundError` on 404,
`EmporixForbiddenError` on 403, etc.) via the shared `HttpClient`. No
service-specific error types.

## Testing

- **Unit (Vitest + MSW):** `tax-types.test.ts` (type-level), `tax.test.ts`
  (MSW: asserts `Bearer svc-tok`, paths, bodies, the `{ locationCode }` create
  response, calculation output, `encodeURIComponent` escaping, 404 → error),
  `tax-wiring.test.ts` (`client.taxes instanceof TaxService`).
- No e2e (admin/service-token; not exercised from the storefront example).

## Out of scope

Nothing deferred within the Tax Service — all six endpoints are bound. Tax
calculation remains server-side (no React/storefront helper).

## Deliverables

Codegen + `tax-types.ts` + `TaxService` + client wiring (logger `"tax"`, facade
`src/tax.ts`, barrel) + `docs/tax.md` + changeset (minor `@viu/emporix-sdk`).
Branch `feat/tax-service` off current `main`, created at execution time.
