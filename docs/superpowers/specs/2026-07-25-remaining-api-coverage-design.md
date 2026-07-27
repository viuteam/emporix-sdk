# Remaining API Coverage — Design

**Date:** 2026-07-25
**Package:** `@viu/emporix-sdk`
**Services:** `CompaniesService`, `ContactsService`, `FeeService`, `TenantConfigService`, `ClientConfigService`
**Spec sources:** `customer-management.yml`, `fee.yml`, `configuration.yml`

## Goal

Close the last gaps of the admin-CRUD series: 8 operations spread over three
service families. After this the SDK wraps every non-deprecated operation of
every vendored spec, apart from two endpoints deliberately declined earlier.

## Verified scope

The running coverage table was stale; every count below was re-verified against
the generated types (and, where the first pass was wrong, corrected):

| Service family | Table said | Verified gap |
|---|---|---|
| customer (`customer.yml` + `customer-service.yml`) | ~8 | **0** — see below |
| customer-management (B2B) | ~6 | **3** |
| fee | ~3 | **3** |
| configuration | ~2 | **2** |

**Customer is already complete.** `customer.yml` has 25 operations: 24 are
wrapped by `CustomerService` (signup/login/session/profile, the full `addresses`
sub-resource including tags, password and email flows). The single gap is
`GET /validateauthtoken`, which was explicitly dropped as YAGNI during PR #160;
two further operations are deprecated upstream (one of them,
`POST /signup/optin/refresh_token`, is wrapped anyway as `resendActivation`).
`customer-service.yml` (the admin surface) is fully covered by
`CustomerAdminService` — all 15 operations. Nothing to do; this design does not
touch the customer services.

**Correction on configuration:** an initial pass reported 6 missing operations
there. That was wrong — a grep pattern missed generic methods
(`async get<T = unknown>(…)`), so the existing single-key `get`/`update` on both
`TenantConfigService` and `ClientConfigService` were overlooked. Only 2
operations are genuinely missing.

## Scope

Extend five existing classes with flat methods. No new classes, no client wiring
changes, no constructor changes. **Each service keeps its own established
conventions** — this design deliberately does not unify them:

- `CompaniesService` / `ContactsService`: `auth: AuthContext` is a **required**
  argument (no default) — these are customer-scoped B2B services.
- `FeeService`, `TenantConfigService`, `ClientConfigService`: backend-only, so
  `auth: AuthContext = SERVICE` with the existing module-level `SERVICE` const.

## API surface

### 1 — customer-management (3)

| Service | Method | HTTP | Returns |
|---|---|---|---|
| `companies` | `search(query, auth)` | POST `/legal-entities/search` | `LegalEntity[]` (200) |
| `companies` | `parentHierarchy(legalEntityId, auth)` | GET `/legal-entities/{id}/parent-hierarchy` | `LegalEntity[]` (200) |
| `contacts` | `get(contactAssignmentId, auth)` | GET `/contact-assignments/{id}` | `ContactAssignment` (200) |

`search` takes a `{ q?: string }` body (the spec declares it inline; the SDK
names it `LegalEntitySearchInput`). `parentHierarchy` returns the chain of
parent entities. `contacts.get` completes that service's CRUD — it already has
`listForCompany`, `assign`, `update` and `unassign`.

### 2 — fee (3)

| Method | HTTP | Returns |
|---|---|---|
| `deleteProductFee(productId, feeId, auth?)` | DELETE `/productFees/{productId}/fees/{feeId}` | `void` (204) |
| `searchItemFeesByProductId(input, auth?)` | POST `/itemFees/searchByProductId` | `ItemFee[]` (200) |
| `searchItemFeesByProductIds(input, auth?)` | POST `/itemFees/searchByProductIds` | `ItemFee[]` (200) |

- `deleteProductFee` (singular) removes **one** fee from a product and sits
  beside the existing `deleteProductFees` (plural), which removes all of them.
  The item-fee side already makes the same distinction via
  `deleteItemFees(itemYrn, feeId?)`; product fees get an explicit second method
  rather than an optional parameter, because the plural method's signature is
  already published without one.
- **The two search bodies are asymmetric in the upstream spec**, and the SDK
  mirrors them verbatim rather than "fixing" them:
  - `searchByProductId` → `{ productId: string; siteCodes: string[]; pageNumber?; pageSize? }`
  - `searchByProductIds` → `{ productIds: string; siteCode: string; pageNumber?; pageSize? }`
    — note `productIds` is a **single string**, not an array, and `siteCode` is
    singular. That reads like an upstream modelling slip, but it is what the
    schema declares; the docstrings flag it.

### 3 — configuration (2)

| Service | Method | HTTP | Returns |
|---|---|---|---|
| `tenantConfig` | `listGlobal(auth?)` | GET `/global-configurations` | `Configuration<T>[]` (200) |
| `clientConfig` | `listClients(auth?)` | GET `/clients` | `string[]` (200) |

`listGlobal` reads the platform-wide configuration entries (a separate resource
from the tenant's own `/configurations`). `listClients` lists the client ids that
have configurations — the natural companion to the existing per-client methods.
`listGlobal` carries the same `<T = unknown>` generic for `value` that the other
configuration reads use.

Note `ClientConfigService.base(client)` builds
`/configuration/{tenant}/clients/{client}/configurations`, so `listClients`
targets `/configuration/{tenant}/clients` directly rather than through that
helper.

### 4 — Public types

| New alias | Source |
|---|---|
| `LegalEntitySearchInput` | `{ q?: string }` (declared in `companies.ts`; the spec has it inline) |
| `ItemFeeSearchByProductId` | generated `SearchItemFee` |
| `ItemFeeSearchByProductIds` | generated `SearchItemsFee` |

Everything else reuses existing aliases: `LegalEntity`, `ContactAssignment`,
`ItemFee`, `Configuration`. The fee aliases go into `fee-types.ts` next to the
existing `ItemFeeSearch`; `LegalEntitySearchInput` is declared and exported in
`companies.ts`, which already declares its types locally.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy. The B2B methods surface a 403 as
`EmporixInsufficientScopeError` when the customer token lacks the `_manage`
scope, exactly like their siblings.

## Testing

Three new unit tests, each matching the harness style of its service's existing
tests, using the `vi.fn()`-mocked `http.request` harness (`ctxWith`):

- `packages/sdk/tests/services/customer-mgmt-admin.test.ts` — `companies.search`
  POSTs `/legal-entities/search` with the `q` body; `companies.parentHierarchy`
  GETs the hierarchy path; `contacts.get` GETs the assignment path. Each asserts
  the supplied auth is forwarded (these services take auth as a required arg).
- `packages/sdk/tests/services/fee-admin.test.ts` — `deleteProductFee` hits the
  fee-scoped path (and is distinct from `deleteProductFees`); both search methods
  POST their paths with the exact asymmetric bodies; `SERVICE` is the default.
- `packages/sdk/tests/services/configuration-admin.test.ts` — `listGlobal` GETs
  `/global-configurations`; `listClients` GETs `/clients`; both default to
  `SERVICE`.

## Release

One changeset `.changeset/remaining-api-coverage.md`, `@viu/emporix-sdk`
**minor**, naming all three service families.

## Out of scope

- `GET /validateauthtoken` — declined as YAGNI in PR #160; not revisited here.
- The deprecated `customer.yml` endpoints.
- React hooks (backend/admin surface).
- The known cart address bug (`setShippingAddress`/`setBillingAddress`), which
  is tracked separately and needs live verification.
- Live tenant verification of these 8 operations.
