# Customer Account Hooks — Design

## Context

`@viu/emporix-sdk-react` today wraps `customers.login` / `signup` / `logout` / `me` / `refresh` / SSO via `useCustomerSession`. The remaining six customer-facing methods on `CustomerService` — `update`, `changePassword`, `requestPasswordReset`, `confirmPasswordReset`, and the four-method `addresses` sub-API (`list`, `add`, `update`, `remove`) — have **no hook coverage**. Any storefront that wants a typical "My Account" experience (edit profile, change password, manage addresses, forgot-password flow) has to drop down to `client.customers.*` directly.

This change adds the missing hooks so consumers can render a full Account-Center without ever bypassing the React layer.

## Goals

- `useUpdateCustomer()` — mutation for `customers.update(patch)`. On success, invalidates the `me` query so `useCustomerSession.customer` reflects the new data.
- `useChangePassword()` — mutation for `customers.changePassword(input)`. Stateless from the storefront's perspective — no cache invalidation, just an action.
- `useCustomerAddresses()` — query for `customers.addresses.list()`. Disabled when no customer token in storage.
- `useAddressMutations()` — `add` / `update` / `remove` mutations following the `useCartMutations` pattern (per-API mutation handles + cache invalidation of the addresses list).
- `usePasswordReset()` — exposes the 2-step flow as two named mutations (`request`, `confirm`) returning the same hook return shape.
- All hooks auto-detect auth like the read hooks (token → customer; otherwise — for the customer-bound mutations — they throw a clear `requires logged-in customer` error). Password-reset is intentionally **anonymous** (the user is locked out).

## Non-Goals

- Customer signup hook — already in `useCustomerSession.signup`.
- Order history — there is no `OrderService` in the SDK yet; that's a separate plan when the SDK ships it.
- Address-list pagination — Emporix returns the full list per the current SDK signature (`Address[]`). If pagination shows up later, the hook signature can extend; not in this scope.
- UI primitives (form components, validation) — those are consumer-side.
- Optimistic updates on address mutations — addresses are low-volume + server-validated; optimistic UI adds complexity without obvious win. Server roundtrip is fast enough.

## Architecture

### File layout

```
packages/react/src/hooks/
├── use-cart.ts                  ← unchanged
├── use-categories.ts            ← unchanged
├── use-checkout.ts              ← unchanged
├── use-customer-session.ts      ← unchanged (existing customer hooks)
├── use-customer-profile.ts      ← NEW — useUpdateCustomer + useChangePassword
├── use-customer-addresses.ts    ← NEW — useCustomerAddresses + useAddressMutations
├── use-password-reset.ts        ← NEW — usePasswordReset (anonymous)
├── use-match-prices.ts          ← unchanged
├── use-my-segments.ts           ← unchanged
├── use-product-media.ts         ← unchanged
├── use-products.ts              ← unchanged
└── internal/
    └── use-read-auth.ts         ← unchanged
```

Three new files, all domain-named, consistent with the rest of the package.

### `useUpdateCustomer()`

```typescript
export function useUpdateCustomer(): UseMutationResult<Customer, unknown, CustomerUpdateInput>
```

Auto-detects customer auth (must be logged in — throws on missing token, same `customerOnlyCtx` helper pattern as `usePaymentModes`). On success, calls `queryClient.invalidateQueries({ queryKey: ["emporix", "customer", "me"] })` so `useCustomerSession.customer` re-fetches.

### `useChangePassword()`

```typescript
export function useChangePassword(): UseMutationResult<void, unknown, PasswordChangeInput>
```

Customer-only. No cache invalidation — the password change doesn't surface in any cached read.

### `useCustomerAddresses()`

```typescript
export function useCustomerAddresses(opts?: QueryOpts): UseQueryResult<Address[]>
```

Customer-only (disabled when no token in storage, same pattern as `usePaymentModes`). Query-key: `["emporix", "customer", "addresses", { tenant, authKind }]`.

### `useAddressMutations()`

```typescript
export interface AddressMutationsApi {
  add: UseMutationResult<Address, unknown, AddressCreateInput>;
  update: UseMutationResult<Address, unknown, { id: string; patch: AddressUpdateInput }>;
  remove: UseMutationResult<void, unknown, { id: string }>;
}

export function useAddressMutations(): AddressMutationsApi
```

Customer-only. Each mutation, on success, invalidates `["emporix", "customer", "addresses"]` so `useCustomerAddresses` refetches the list. No optimistic update — server is fast and addresses are low-volume.

### `usePasswordReset()`

```typescript
export interface PasswordResetApi {
  request: UseMutationResult<void, unknown, PasswordResetRequestInput>;
  confirm: UseMutationResult<void, unknown, PasswordResetConfirmInput>;
}

export function usePasswordReset(): PasswordResetApi
```

Both mutations use `auth.anonymous()` — the user is by definition locked out when running this flow. No cache invalidation; after `confirm` succeeds, the storefront UI typically redirects to `/login`.

### Shared auth helper

All six customer-bound mutations need the same "token from storage or throw" check. Reuse the existing `customerOnlyCtx` from `use-checkout.ts` by extracting it into `hooks/internal/use-read-auth.ts` next to `useReadAuth`:

```typescript
// hooks/internal/use-read-auth.ts (appended)
export function useCustomerOnlyCtx(): AuthContext {
  const { storage } = useEmporix();
  const token = storage.getCustomerToken();
  if (!token) {
    throw new Error("Requires a logged-in customer (no token in storage)");
  }
  return auth.customer(token);
}
```

The existing local `customerOnlyCtx` in `use-checkout.ts` gets removed in favor of this shared helper. `usePaymentModes` updates to use it too.

### Public API additions

In `packages/react/src/hooks/index.ts`:

```typescript
export { useUpdateCustomer, useChangePassword } from "./use-customer-profile";
export {
  useCustomerAddresses,
  useAddressMutations,
  type AddressMutationsApi,
} from "./use-customer-addresses";
export { usePasswordReset, type PasswordResetApi } from "./use-password-reset";
```

In `packages/react/src/index.ts`: same names added to the root re-export list.

## Data Flow

### Edit profile

```
[user submits "Edit Profile" form]
  ↓
useUpdateCustomer().mutateAsync({ firstName: "New" })
  ↓ PUT /customer/{tenant}/me  (customer token)
  ↓ onSuccess → qc.invalidateQueries(["emporix", "customer", "me"])
[useCustomerSession.customer re-fetches → form re-renders with new value]
```

### Add address

```
[user submits "Add Address" form]
  ↓
useAddressMutations().add.mutateAsync({ street, city, ... })
  ↓ POST /customer/{tenant}/me/addresses
  ↓ onSuccess → qc.invalidateQueries(["emporix", "customer", "addresses"])
[useCustomerAddresses re-fetches → list updates]
```

### Password reset (anonymous)

```
[1] User on /forgot-password enters email:
    usePasswordReset().request.mutateAsync({ email })
    → POST /customer/{tenant}/password/reset (anonymous)
    → Emporix sends an email with a reset token

[2] User on /reset-password?token=… enters new password:
    usePasswordReset().confirm.mutateAsync({ token, newPassword })
    → POST /customer/{tenant}/password/reset/confirm (anonymous)
    → On success, redirect to /login (consumer-side)
```

## Testing

Unit tests in `packages/react/tests/` — one file per hook file:

- `tests/use-customer-profile.test.tsx`
  - `useUpdateCustomer` PUTs the patch, returns updated Customer.
  - `useUpdateCustomer` invalidates `customer.me` on success (verify by re-fetching and checking the new value).
  - `useUpdateCustomer` throws cleanly when no token in storage.
  - `useChangePassword` PUTs the input, resolves to void.
  - `useChangePassword` throws cleanly when no token in storage.

- `tests/use-customer-addresses.test.tsx`
  - `useCustomerAddresses` is disabled when no token.
  - `useCustomerAddresses` GETs the list with customer auth and returns the array.
  - `useAddressMutations.add` POSTs, returns Address.
  - `useAddressMutations.update` PUTs the patch with id in path, returns Address.
  - `useAddressMutations.remove` DELETEs the id, returns void.
  - Each mutation triggers `useCustomerAddresses` refetch (verify call count).

- `tests/use-password-reset.test.tsx`
  - `usePasswordReset.request` POSTs with anonymous auth.
  - `usePasswordReset.confirm` POSTs with anonymous auth.
  - Neither needs a customer token (works without).

Existing `use-checkout.test.tsx` updates to reflect the moved `customerOnlyCtx` (now in the shared helper) — should be a non-behavioral change, tests stay green.

## Risk / Compatibility

| Concern | Mitigation |
|---|---|
| `customerOnlyCtx` extraction breaks `useCheckout` | Existing tests pass post-refactor; helper signature stays identical |
| New mutations cascade unwanted invalidations | Each mutation invalidates only its narrow query-key (`customer.me` or `customer.addresses`) |
| Password reset accidentally requires login | Hard-coded anonymous auth in `usePasswordReset`; explicit test asserts no token needed |
| Address list refetch storm on rapid mutations | React Query's default behavior (one refetch per invalidation, dedup'd) handles this |

**Changeset:** minor for `@viu/emporix-sdk-react`. SDK is untouched.

## File Structure

| File | Change |
|---|---|
| `packages/react/src/hooks/internal/use-read-auth.ts` | Add `useCustomerOnlyCtx` helper |
| `packages/react/src/hooks/use-checkout.ts` | Replace local `customerOnlyCtx` with shared `useCustomerOnlyCtx` |
| `packages/react/src/hooks/use-customer-profile.ts` | **CREATE** — `useUpdateCustomer`, `useChangePassword` |
| `packages/react/src/hooks/use-customer-addresses.ts` | **CREATE** — `useCustomerAddresses`, `useAddressMutations`, `AddressMutationsApi` |
| `packages/react/src/hooks/use-password-reset.ts` | **CREATE** — `usePasswordReset`, `PasswordResetApi` |
| `packages/react/src/hooks/index.ts` | Re-export all new symbols |
| `packages/react/src/index.ts` | Re-export all new symbols at package root |
| `packages/react/tests/use-customer-profile.test.tsx` | **CREATE** — 5 tests |
| `packages/react/tests/use-customer-addresses.test.tsx` | **CREATE** — 6 tests |
| `packages/react/tests/use-password-reset.test.tsx` | **CREATE** — 3 tests |
| `.changeset/customer-account-hooks.md` | Minor changeset |
| `docs/react.md` | Document the new hooks under a "Customer Account" subsection |

## Out-of-scope follow-ups

- Optimistic updates on address mutations — only if a consumer reports perceived lag.
- Order-history hooks — separate plan, dependent on the SDK shipping an OrderService first.
- Self-service email change — Emporix has a separate flow involving a verification email; out of scope for the first cut.
- Migration of an example app to demonstrate the Account Center — possible follow-up; the vite-spa Example currently has no account-center page.
