# Cart Address Fix — Design

**Date:** 2026-07-27
**Package:** `@viu/emporix-sdk`
**Service:** `CartService` (`client.carts`)
**Spec source:** `packages/sdk/specs/cart.yml` → generated `src/generated/cart/types.gen.ts`

## Goal

`cart.setShippingAddress` and `cart.setBillingAddress` target endpoints that do
not exist — every call 404s. Fix both to use the documented mechanism, and add a
`setAddresses` method for callers who want to set both addresses in a single
request.

## The bug

Both methods PUT to paths absent from `cart.yml` and from the generated types
(0 hits in either):

- `PUT /cart/{tenant}/carts/{cartId}/shipping-address`
- `PUT /cart/{tenant}/carts/{cartId}/billing-address`

Live-verified against the viu tenant on 2026-07-27 with throwaway anonymous
carts: **both return 404**. Cart addresses are set through
`PUT /cart/{tenant}/carts/{cartId}` with `UpdateCart.addresses` — an array of
`AddressRequest`, each carrying `type: 'BILLING' | 'SHIPPING'`. The spec allows
one address of each type; further entries are ignored.

This is the same class of defect as the four fixed in PR #159, and it survived
unit tests for the same reason: those tests mock HTTP and never see the real
path.

## Live-established semantics

These probes drive the design; each was run against the real API:

| Request | Result |
|---|---|
| PUT `{addresses:[SHIPPING, BILLING]}` | 204 — both stored |
| PUT `{addresses:[SHIPPING]}` only | 204 — **BILLING left as an empty stub**: the type slot survives but `contactName`, `zipCode` etc. are wiped |
| PUT `{addresses:[]}` | 204 — **both wiped to stubs** |
| PUT `{currency}`, `addresses` key omitted | 204 — **addresses fully preserved** |
| read → merge → PUT (new SHIPPING plus the untouched BILLING resent) | 204 — SHIPPING updated, BILLING intact |

Two consequences:

1. **The array is a full replace.** Setting one address without resending the
   other silently guts it. A naive fix would corrupt data with no error.
2. **Omitting the `addresses` key is safe.** `cart.update()` (added in #167)
   therefore has no data-loss footgun and needs no change.

## Design

Two different jobs, two different shapes — the safe default and the explicit one.

### 1 — `setShippingAddress` / `setBillingAddress` (signatures unchanged)

```ts
setShippingAddress(cartId: string, address: CartAddress, auth: AuthContext): Promise<Cart>
setBillingAddress(cartId: string, address: CartAddress, auth: AuthContext): Promise<Cart>
```

Behavior becomes read → merge → PUT → re-fetch:

1. `GET /carts/{cartId}` to read the current `addresses`.
2. Drop any existing entry of the type being set; keep the other type as-is.
3. Append the new address with `type` forced to `SHIPPING` / `BILLING`
   (whatever the caller passed in `address.type` is overridden — the method name
   is the contract).
4. `PUT /carts/{cartId}` with the merged array (204).
5. Re-fetch and return the updated `Cart`, preserving the existing return type.

The public signature and return type are unchanged, so no caller, React hook or
doc needs touching. The cost is one extra GET per call — the price of not
destroying the other address.

Both methods keep `requireCartAuth(auth)`, matching every other storefront cart
method.

### 2 — `setAddresses` (new)

```ts
setAddresses(
  cartId: string,
  addresses: { shipping?: CartAddress; billing?: CartAddress },
  auth: AuthContext,
): Promise<Cart>
```

A single PUT, no preceding read: it sends exactly the addresses given and
**replaces the cart's address set**. Omitting a type clears it; passing `{}`
clears both. That mirrors the endpoint's real semantics and is the efficient
choice when the caller already knows both addresses — e.g. a checkout form that
submits shipping and billing together.

Each provided address gets its `type` forced to the matching value, as above.
The method PUTs, then re-fetches and returns the `Cart`.

The docstring states the replace semantics plainly and points to
`setShippingAddress`/`setBillingAddress` for the preserving variant, so the
footgun is opt-in rather than hidden.

### Why both

`setShippingAddress` is what an incremental checkout wants (set one field, leave
the rest alone) and must be safe by default. `setAddresses` is what a
submit-everything form wants and saves a round-trip. Making the safe one the
default and the destructive one explicit puts the sharp edge where it is visible.

## Error handling

No new error handling. `requireCartAuth` still throws `EmporixValidationError`
before any request when the context is not customer/anonymous. A 404 from the
initial GET (unknown cart) propagates unchanged.

## Testing

Extend `packages/sdk/tests/services/cart-admin.test.ts` (the vi-mock harness) —
the existing `facade-coverage.test.ts` assertions for these two methods are
updated to the new call sequence.

- `setShippingAddress` issues GET → PUT → GET; the PUT body's `addresses`
  contains the new SHIPPING entry **and** the pre-existing BILLING entry
  unchanged. This is the regression test for the data-loss bug.
- `setBillingAddress` does the mirror case.
- A caller-supplied `address.type` that contradicts the method is overridden.
- Setting an address on a cart that has none produces a single-entry array.
- `setAddresses` issues exactly one PUT (no leading GET) with only the given
  types, then re-fetches.
- Both still reject a non-cart auth context via `requireCartAuth`.

The React hooks (`use-cart.ts`) and `docs/react.md` need no change — the
signatures are identical.

## Release

Changeset `.changeset/cart-address-fix.md`, `@viu/emporix-sdk` **patch** for the
bug fix plus **minor** for the added method — a single **minor** entry covers
both, describing the fix first.

## Out of scope

- Exposing `setAddresses` as a React hook (the existing two hooks keep working
  unchanged; a hook can follow if a storefront needs it).
- Any change to `cart.update()` — verified safe.
