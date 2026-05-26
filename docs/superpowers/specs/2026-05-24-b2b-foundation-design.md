# B2B Foundation — Design Spec

**Date**: 2026-05-24
**Status**: Approved (brainstorming) → ready for writing-plans
**Scope**: Sub-Spec #1 of the B2B initiative. Subsequent sub-specs cover Quotes (#2), Approvals (#3), Shared Orders + Customer Groups visibility (#4), Account-Limits in Checkout (#5). Each depends on this one.

## Goal

Make the SDK and React bindings B2B-aware: model the *active legal entity* (company) a customer is acting on behalf of, expose CRUD over Emporix Customer Management (Legal Entities, Contact Assignments, Locations) and IAM Customer-Group-membership, and wire `legalEntityId` through the existing cart/checkout/auth surface — without breaking the B2C buyer flow.

## Non-Goals

- Quotes, Approvals, Shared Orders, Account-Limit enforcement in checkout, custom Customer-Group creation. All deferred to later sub-specs.
- E2E coverage. Added when the `viu` tenant has B2B fixtures (separate follow-up spec).
- Server-side Emporix configuration (tenant restrictions, group definitions, mixin schemas).
- Admin-Dashboard parity. We expose the storefront-customer-facing surface only — admin actions are restricted to what an Admin-Group customer token can do via `customermanagement.*_manage` scopes.

## Background

Emporix models B2B around a few resources:

- **Legal Entity** — a company or subsidiary, with `accountLimit`, `legalInfo`, assigned customer groups, addresses, and an approval group.
- **Contact Assignment** — links a customer to a legal entity with a type (`PRIMARY` | `BILLING` | `LOGISTICS` | `CONTACT`).
- **Location** — a `HEADQUARTER`, `WAREHOUSE`, or `OFFICE` owned by a legal entity.
- **Customer Group** (IAM Service, with `b2b.legalEntityId`) — predefined `Admin`/`Buyer`/`Requester`/`Contact` groups per company, or custom groups. Membership grants scopes.
- **Token scoping** — `customer.refresh({ legalEntityId })` returns a customer token scoped to a specific legal entity. All B2B-scoped server-side checks (cart per company, addresses, orders, account limits) are enforced based on this scope.

The SDK already has two B2B-aware seams: `client.carts.getCurrent(auth, { legalEntityId })` and `client.customers.refresh({ legalEntityId })`. They are unused today because no React surface knows about companies. This spec closes that gap.

## Decisions (from brainstorming)

| # | Decision | Why |
|---|---|---|
| D1 | Service organisation: flat — `client.companies` / `client.contacts` / `client.locations` / `client.customerGroups` | Matches the existing convention (`client.carts`, `client.products`, …). Avoids nested indirection. |
| D2 | API surface: read + full admin mutations | Storefront admin-group customers manage their company's contacts/locations on the storefront; merchant-only ops (group creation, mixin schemas) stay out. |
| D3 | Active-company UX: hybrid pick — auto on 1 company, explicit on >1 | Matches what Emporix's own docs describe; minimises boilerplate for the common single-company case. |
| D4 | B2C-mode valid — `activeCompany = null` is a first-class state | Customers who are members of companies can also shop privately. |
| D5 | Token-refresh-on-switch: eager (refresh before the switch resolves) | Server enforces scopes on the token. Lazy would force every B2B-scoped call to retry on 401/403. |
| D6 | Cart-ID drop on switch (no per-company namespacing) | Simpler storage; one extra roundtrip per switch is acceptable. |
| D7 | Tests: unit-only (Vitest + MSW). E2E deferred. | `viu` tenant lacks B2B fixtures today. |
| D8 | Example update: `examples/vite-spa` only | Reference storefront. `next-app-router` + `node-server` follow if needed later. |

## Architecture

### Layers

```
EmporixProvider
  ├─ SiteContextProvider          (existing — site/currency)
  └─ CompanyContextProvider       (NEW — active company)
       └─ children                (cart/checkout hooks read both)
```

The `CompanyContextProvider` lives strictly inside the SiteContextProvider so company-scoped queries can read `siteCode` if they need to.

### SDK service surface

All new façades live in `packages/sdk/src/services/` and are re-exported from `packages/sdk/src/<name>.ts`. Generated types live under `packages/sdk/src/generated/customer-management/` and `packages/sdk/src/generated/iam/`.

| Façade | Endpoint root | Methods | Scope (customer token) |
|---|---|---|---|
| `client.companies` | `/customer-management/{tenant}/legal-entities` | `listMine(auth, opts?)`, `get(id, auth)`, `create(input, auth)`, `update(id, patch, auth)`, `delete(id, auth)` | `legalentity_read_own` (list/get) / `legalentity_manage` (mutations) |
| `client.contacts` | `/customer-management/{tenant}/contact-assignments` | `listForCompany(legalEntityId, auth, opts?)`, `assign({legalEntity, customer, type, primary?}, auth)`, `update(id, patch, auth)`, `unassign(id, auth)` | `contactassignment_read` / `contactassignment_manage` |
| `client.locations` | `/customer-management/{tenant}/locations` | `listForCompany(legalEntityId, auth, opts?)`, `get(id, auth)`, `create(input, auth)`, `update(id, patch, auth)`, `delete(id, auth)` | `location_read` / `location_manage` |
| `client.customerGroups` | `/iam/{tenant}/groups` (filtered by `b2b.legalEntityId`) | `listForCompany(legalEntityId, auth, opts?)`, `addMember(groupId, customerId, auth)`, `removeMember(groupId, customerId, auth)` | tenant-configured; expected to require an Admin-Group customer token. If the tenant restricts these to client-credentials only, `addMember`/`removeMember` will surface `InsufficientScopeError` and the storefront must hide the management UI. |

All methods take an explicit `AuthContext` (existing convention). On 403, the SDK throws a new typed `InsufficientScopeError extends ForbiddenError` with `requiredScope?: string` so React-Query can surface "Admin role required"-style messages.

Pagination follows `docs/pagination.md` — list endpoints return paginated results compatible with `useEmporixInfinite`.

### SDK changes to existing code

| File | Change |
|---|---|
| `packages/sdk/src/services/cart.ts` | No method change. Doc-comment clarifies that `getCurrent({ legalEntityId })` returns a different cart than the same call without it. |
| `packages/sdk/src/services/customer.ts` | No method change. `me()` may surface `companyAssignments?` if the server includes them; treated as optional, the source of truth stays `client.companies.listMine()`. |
| `packages/sdk/src/services/checkout.ts` | Order-creation calls accept an optional `legalEntityId` in the order payload so an order is attached to the right legal entity. The SDK never parses the token — the React layer reads the active id from `CompanyContext` and passes it explicitly; if absent, no `legalEntityId` is sent and the server falls back to whatever the token scope dictates. `usePaymentModes`-customer-only path is untouched. |
| `packages/sdk/src/core/errors.ts` | New `InsufficientScopeError` class. |
| `packages/sdk/src/core/http.ts` | 403 → maps to `InsufficientScopeError` when response body identifies a missing scope; otherwise falls back to `ForbiddenError`. |
| `packages/sdk/src/core/auth.ts` | No change. `AuthContext` is unchanged. `legalEntityId` is per-call payload, not auth-context-level. |
| `packages/sdk/src/client.ts` | New fields `companies`, `contacts`, `locations`, `customerGroups`. New `ServiceName` enum entries `'customerManagement'` and `'iam'` (used for logger scoping). |

### React layer

**Context — `useActiveCompany()`** returns:

```ts
type CompanyContextValue = {
  activeCompany: LegalEntity | null;    // null = B2C-mode (no LE scope on token)
  myCompanies: LegalEntity[];           // all companies this customer is assigned to
  mode: 'b2c' | 'b2b' | 'unresolved';   // 'unresolved' = customer has >1 companies but hasn't picked yet
  status: 'idle' | 'loading' | 'switching' | 'error';
  setActiveCompany: (legalEntityId: string | null) => Promise<void>;
  refetchMyCompanies: () => Promise<void>;
};
```

**Bootstrap** (on customer-token load):

1. Call `client.companies.listMine()`; cache as `myCompanies`.
2. If `storage.get('emporix.activeLegalEntityId')` is set and matches a company in `myCompanies` → pick it (no refresh needed; token is already scoped).
3. Else if `myCompanies.length === 1` → auto-pick → triggers `setActiveCompany(id)`.
4. Else if `myCompanies.length > 1` → `activeCompany = null`, `mode = 'unresolved'`. App must render a picker before B2B-scoped queries should be expected to work.
5. Else (`myCompanies.length === 0`) → `mode = 'b2c'`.

**`setActiveCompany(id)`** flow:

1. `status = 'switching'`.
2. `client.customers.refresh({ refreshToken, legalEntityId: id })` → new scoped customer token.
3. Replace `customerToken` in storage; set `activeLegalEntityId = id` (or remove on `null`).
4. Drop `cartId` (next `useCart` resolves via `getCurrent({ legalEntityId, create: true })`).
5. `queryClient.invalidateQueries({ predicate })` — predicate matches any key whose tuple contains the current customer-id or any `legalEntityId`.
6. Emit telemetry event `company:switched` with `{ from, to }`.
7. `status = 'idle'`; resolve.

**Hooks** (`packages/react/src/hooks/`):

```ts
// Reads
useMyCompanies()                        → UseQueryResult<LegalEntity[]>
useCompany(legalEntityId)               → UseQueryResult<LegalEntity>
useCompanyContacts(legalEntityId)       → UseQueryResult<ContactAssignment[]>
useCompanyLocations(legalEntityId)      → UseQueryResult<Location[]>
useCompanyGroups(legalEntityId)         → UseQueryResult<CustomerGroup[]>

// Mutations (require *_manage scope on customer token)
useCreateCompany()
useUpdateCompany()
useDeleteCompany()
useAssignContact()
useUpdateContactAssignment()
useUnassignContact()
useCreateLocation()
useUpdateLocation()
useDeleteLocation()
useAddCustomerGroupMember()
useRemoveCustomerGroupMember()

// Convenience
useCompanySwitcher()  // { companies, active, switch(id), clear() }
```

Query-key convention: B2B-scoped keys include the active `legalEntityId` as the third tuple element. Existing hooks (`useCart`, `useCheckout`, `useCustomerAddresses`) read `legalEntityId` from `CompanyContext` and append it to their keys → automatic invalidation on switch.

Mutation hooks invalidate the relevant read-query keys on success.

### Storage & token lifecycle

New `EmporixStorageKey` member: `'emporix.activeLegalEntityId'` (string | null). Backends (`local-storage`, `cookie`, `memory`) need no code change — they're key-agnostic. `subscribeAll` propagates changes to the telemetry stream.

Lifecycle matrix:

| Event | `customerToken` | `cartId` | `activeLegalEntityId` |
|---|---|---|---|
| Login (B2C) | set | kept (bootstrap-cart re-resolves via `getCurrent`) | stays `null` |
| Login (B2B, 1 company) | set, then refreshed with LE | dropped | set to LE id |
| Login (B2B, >1 companies) | set | dropped | stays `null` until user picks |
| `setActiveCompany(newId)` | replaced (rescoped refresh) | dropped | overwritten |
| `setActiveCompany(null)` | replaced (refresh without LE) | dropped | cleared |
| Logout | cleared | cleared | cleared |
| Reload | kept | kept | kept — provider validates against `listMine()` and drops on mismatch |

SSR: `packages/react/src/ssr.ts` and `EmporixProvider` accept a new `initialActiveLegalEntityId?: string` prop. Server components forward it from the request to prevent hydration mismatch.

Anonymous sessions are unaffected. B2B requires a customer token.

### Errors

- `InsufficientScopeError extends ForbiddenError` — `{ requiredScope?: string }`. Thrown when the server returns 403 with an explicit missing-scope hint.
- Existing `UnauthorizedError` keeps current behaviour (token expired/invalid).
- Mutation hooks surface these as React-Query `error`; the storefront can render "Admin role required" UX from `error.requiredScope`.

### Telemetry

New event type emitted via the existing `onTelemetry` channel:

```ts
{ kind: 'company:switched', from: string | null, to: string | null, durationMs: number }
```

Same channel already carries `auth:*`, `cache:*`, `mutation:*` events.

## Test plan (unit only)

### `packages/sdk/tests/`

- `companies.test.ts` — `listMine`/`get`/`create`/`update`/`delete`; happy path + 403 `InsufficientScopeError` mapping.
- `contacts.test.ts` — `assign`/`unassign`; rejects invalid `type` enum values.
- `locations.test.ts` — `create`/`update` with each location `type` (`HEADQUARTER` | `WAREHOUSE` | `OFFICE`).
- `customer-groups.test.ts` — `listForCompany` / `addMember` / `removeMember`.
- `errors.test.ts` — 403 with missing-scope body → `InsufficientScopeError`; 403 without body → `ForbiddenError`.
- Extend `customer.refresh.test.ts` — refresh with `legalEntityId` produces a different token; refresh without it returns to a non-scoped token.
- Extend `cart.getCurrent.test.ts` — different `legalEntityId` values resolve to distinct carts.

### `packages/react/tests/`

- `use-active-company.bootstrap.test.tsx` — covers the four bootstrap cases (0 / 1 / >1 companies, plus persisted `activeLegalEntityId` matching and not matching).
- `use-active-company.switch.test.tsx` — `setActiveCompany(id)` calls refresh, drops cart-id, invalidates company-scoped queries, emits `company:switched`.
- `use-my-companies.test.tsx` — query caching, refetch after `useCreateCompany` mutation.
- `use-company-contacts.test.tsx` — invalidation after `useAssignContact`.
- `provider.b2b.test.tsx` — `CompanyContextProvider` mounts; `initialActiveLegalEntityId` (SSR) wins over a stale stored value.

MSW handlers in `packages/react/tests/handlers/` cover the new endpoints. No real HTTP calls.

## Example update

`examples/vite-spa/`:

- `src/components/CompanySwitcher.tsx` — header dropdown listing `myCompanies` + a "Privat" entry for `null` (B2C).
- `src/components/CompanyBadge.tsx` — small badge under the logo: `B2C` / company name / "Bitte Firma wählen".
- Cart page shows active-company context inline.
- Login flow unchanged; the switcher appears only when logged in and `myCompanies.length > 0`.

`examples/next-app-router` and `examples/node-server` stay untouched.

## Docs update

- New `docs/b2b.md` — concepts (Legal Entity / Contact / Location / Customer Group), active-company model, hooks reference, storage keys, token-scope behaviour.
- `docs/auth.md` — append `customer.refresh({ legalEntityId })` semantics.
- `docs/checkout.md` — note that orders inherit the active legal-entity scope.

## Release

`pnpm changeset`:

- `@viu/emporix-sdk` — minor. *"B2B foundation: new `companies`/`contacts`/`locations`/`customerGroups` services; `InsufficientScopeError`; checkout accepts `legalEntityId`."*
- `@viu/emporix-sdk-react` — minor. *"B2B foundation: `useActiveCompany`, B2B read/mutation hooks, company-aware query keys, `emporix.activeLegalEntityId` storage key, `company:switched` telemetry event."*

Examples are in the `.changeset/config.json` ignore list — no entries needed.

Commitlint: all touched scopes (`sdk`, `react`, `docs`, `examples`) are in the allowlist. Subjects start with a lowercase verb (`add`, `wire`, etc.).

## Out of scope (sub-specs to follow)

| Sub-spec | What | Depends on |
|---|---|---|
| #2 Quotes | Quote service (create/list/accept/reject) + hooks | this spec |
| #3 Approvals | Approval service for requester+approver flows + hooks | this spec |
| #4 Shared Orders | Company-scoped order listing + customer-group-permission surface | this spec |
| #5 Account Limits in Checkout | Limit display + block on overrun in checkout | this spec |
| Follow-up: E2E | Playwright B2B suite once `viu` tenant has B2B fixtures | this spec |
