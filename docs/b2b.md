# B2B Foundation

> Available since `@viu/emporix-sdk@<next minor>` and `@viu/emporix-sdk-react@<next minor>`.
> See `docs/superpowers/specs/2026-05-24-b2b-foundation-design.md` for the design rationale.

## Concepts

- **Legal Entity** — a company or subsidiary (`type: "COMPANY" | "SUBSIDIARY"`). Has an account limit, legal info, addresses, and assigned customer groups.
- **Contact Assignment** — links a customer to a legal entity with a type: `PRIMARY`, `BILLING`, `LOGISTICS`, or `CONTACT`.
- **Location** — a `HEADQUARTER`, `WAREHOUSE`, or `OFFICE` owned by a legal entity.
- **Customer Group** — IAM group keyed by `b2b.legalEntityId`. Predefined: Admin, Buyer, Requester, Contact.

## Active-company model

`useActiveCompany()` returns:

| Field | Meaning |
|---|---|
| `activeCompany: LegalEntity \| null` | `null` = B2C mode (no LE scope on token) |
| `myCompanies: LegalEntity[]` | All companies this customer is assigned to |
| `mode: "b2c" \| "b2b" \| "unresolved"` | `unresolved` = >1 companies, none picked yet |
| `status` | `"idle" \| "loading" \| "switching" \| "error"` |
| `setActiveCompany(id \| null)` | Eager refresh + cart-id drop + query invalidation |
| `refetchMyCompanies()` | Force a refetch of `listMine()`. |

Bootstrap behaviour:

- 0 companies → `mode: "b2c"`
- 1 company → auto-picked, `mode: "b2b"`
- >1 companies + no persisted pick → `mode: "unresolved"`, app must render a picker
- Persisted pick that matches → restored without re-fetching the token
- Persisted pick that doesn't match → silently dropped, falls back to 0/1/many logic

## Hooks

```ts
// Reads
useMyCompanies()             // UseQueryResult<LegalEntity[]>
useCompany(legalEntityId)    // UseQueryResult<LegalEntity>
useCompanyContacts(id)       // UseQueryResult<ContactAssignment[]>
useCompanyLocations(id)      // UseQueryResult<Location[]>
useCompanyGroups(id)         // UseQueryResult<IamGroup[]> (read-only in this slice)

// Mutations (require *_manage scope on the customer token)
useCreateCompany / useUpdateCompany / useDeleteCompany
useAssignContact / useUpdateContactAssignment / useUnassignContact
useCreateLocation / useUpdateLocation / useDeleteLocation

// Convenience
useCompanySwitcher()         // { companies, active, status, switch(id), clear() }
```

## Storage keys

- `emporix.customerToken` — scoped to the active legal entity (or unscoped in B2C).
- `emporix.activeLegalEntityId` — local mirror of which company is active.
- `emporix.refreshToken` — needed for the eager refresh-on-switch flow. Without it, switch falls back to a local-state-only update (no server-side token rescope). `useCustomerSession` writes this on login/refresh.
- `emporix.cartId` — dropped on every `setActiveCompany` call (the next `useCart` resolves a fresh cart via `getCurrent`).

## Token scope

Switching company calls `customer.refresh({ refreshToken, legalEntityId })` which returns a new bearer token scoped to that entity. All subsequent SDK calls are evaluated against that scope on the server. Switching to `null` re-issues a non-scoped token (B2C).

## Insufficient scope

Mutation hooks throw `EmporixInsufficientScopeError` (extends `EmporixForbiddenError`) when the server returns 403 with a `missing scope:` hint. UI can switch off management controls based on `error.requiredScope`.

## SSR

`EmporixProvider` accepts `initialActiveLegalEntityId?: string | null` so server-rendered HTML matches the client bootstrap.

## Customer-group membership mutations

`useAddCustomerGroupMember` / `useRemoveCustomerGroupMember` are deferred to a follow-up plan — the IAM `/groups/{id}/members` exact endpoint shape is not yet vendored. `useCompanyGroups` ships read-only here.
