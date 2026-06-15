# Checkout: separate billing/shipping address + configured payment selection

**Status:** Design approved — ready for implementation planning
**Date:** 2026-06-15
**Branch:** `feat/checkout-address-payment`

## Summary

Extend the `storefront-demo` checkout so a shopper can (1) optionally enter a
billing address that differs from the shipping address, and (2) pick a payment
option from the modes configured in Emporix. Making the payment list available
to guests requires relaxing an over-strict auth check in the SDK and React
packages, so the work spans three packages.

## Goals

- Shipping and billing address can be set independently, gated behind a
  "billing address = shipping address" toggle (default on).
- Logged-in customers can pick from their saved addresses **or** type a new one;
  guests always type.
- Payment options come from the tenant's configured frontend payment modes
  (`GET /payment-gateway/{tenant}/paymentmodes/frontend`), shown as a selectable
  list — for guests **and** logged-in customers.
- The selected mode is sent in the checkout payload.

## Non-goals

- No real payment-gateway completion: no tokenization JS, no OFFSITE redirect,
  no SEPA mandate flow. We select a configured mode and send its `modeId`; we do
  not drive the gateway's client-side flow ("pick-and-send").
- No changes to the other examples (`vite-spa`, `next-app-router`, `node-server`).
- No new checkout capability in the SDK beyond relaxing the payment-modes auth.

## Background / findings

- `examples/storefront-demo/src/pages/Checkout.tsx` currently uses **one**
  address form, sent identically as both `BILLING` and `SHIPPING`, and a
  hardcoded `paymentMethods: [{ provider: "custom", amount }]`. It already
  supports both guest and logged-in checkout.
- `usePaymentModes()` (React) is gated on a customer token and resolves a
  customer-only auth context via `customerOnlyCtx`, which throws without a token.
- The SDK's `PaymentGatewayService.listPaymentModes` calls `requireCustomer(auth)`.
- **The Emporix docs state the frontend payment-modes endpoint requires "No
  scope"** — it needs *a* bearer token (401 otherwise) but not a customer scope.
  The anonymous session token satisfies it. The customer-only restriction is
  therefore a bug, not an API limit.
- Established SDK pattern for "any token, default anonymous" public reads:
  `site.ts` / `session-context.ts` use `const ANON = auth.anonymous()` as the
  default `AuthContext`.
- `useReadAuth()` (React) already resolves "customer token if present, else
  anonymous" — exactly what the relaxed `usePaymentModes` needs.
- `RequestPaymentMethodJson` accepts
  `{ provider, customAttributes: { modeId, token, paymentType }, method, amount }`;
  provider values are `payment-gateway` (with `modeId`), `custom`, `none`.
- `AddressJson` requires `contactName, street, zipCode, city, country, type`
  (`type` ∈ `SHIPPING`/`BILLING`); there must be at least one of each.
- `useCustomerAddresses()` lists a logged-in customer's saved addresses;
  `account/AddressForm.tsx` is coupled to `useAddressMutations` (persists to the
  account) and is therefore the wrong building block for an inline checkout
  sub-form.

## Design

### Component decomposition (chosen over inline expansion / reusing AddressForm)

Inline expansion would push `Checkout.tsx` past ~400 lines with two address
forms, a toggle, and a payment list — hard to read and change. Reusing
`account/AddressForm` fails because it owns its submit and persistence. So we
extract focused, independently testable units under
`examples/storefront-demo/src/checkout/`.

### 1. SDK — `packages/sdk/src/services/payment.ts`

Relax `listPaymentModes` from customer-only to "any token, default anonymous",
mirroring `site.ts`:

```ts
import { auth, type AuthContext } from "../core/auth";
const ANON: AuthContext = auth.anonymous();
// ...
async listPaymentModes(authCtx: AuthContext = ANON): Promise<PaymentMode[]> {
  return this.ctx.http.request<PaymentMode[]>({
    method: "GET",
    path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/frontend`,
    auth: authCtx,
  });
}
```

- `authorize()` stays customer-only (`requireCustomer`) — it is a real payment
  action. Keep the `requireCustomer` import for it.
- Add the `auth` value to the existing `core/auth` import.
- Remove any import left unused after the change (e.g. `EmporixAuthError` if no
  longer referenced).

### 2. React — `packages/react/src/hooks/use-checkout.ts`

Decouple `usePaymentModes` from the customer token:

- Remove the local `customerOnlyCtx` helper.
- Resolve auth via `const { ctx } = useReadAuth()` (customer if token, else
  anonymous).
- `enabled: options.enabled ?? true` — drop the `token !== null` gate.
- Query key: `authKind: ctx.kind` instead of the hardcoded `"customer"`.
- `queryFn: () => client.payments.listPaymentModes(ctx)`.
- Drop the now-unused `useCustomerToken` / `auth` imports in this file.

### 3. React docs / repo notes

- Update `docs/react.md` where it describes `usePaymentModes` as customer-only.
- Update the `CLAUDE.md` note that calls `usePaymentModes` "intentionally
  customer-only" — it now works anonymously too.

### 4. Example — new components in `examples/storefront-demo/src/checkout/`

| File | Responsibility | Depends on |
|---|---|---|
| `AddressFields.tsx` | Pure, controlled field set: `contactName`, `companyName?`, `street` + `streetNumber`, `zipCode` + `city` + `country`, `contactPhone?`. No submit, no header. Exports the `AddressDraft` type. | `ui/Field` |
| `AddressSection.tsx` | Wraps `AddressFields` with a title and, for logged-in customers, a `<select>` of saved addresses + a "Enter new address" option. Selecting a saved address copies its fields into the draft; fields stay editable. | `AddressFields`, `useCustomerAddresses` |
| `PaymentSelector.tsx` | Calls `usePaymentModes()`; renders a radio list (each option shows `code` — falling back to `id` — plus a small `integrationType` tag). Loading → spinner. Empty/error → a single muted "Demo (custom provider)" note and selection `null`. Default selection = first mode. | `usePaymentModes`, `ui/Spinner` |

`AddressDraft`:

```ts
type AddressDraft = {
  contactName: string;
  companyName?: string;
  street: string;
  streetNumber?: string;
  zipCode: string;
  city: string;
  country: string;
  contactPhone?: string;
};
```

### 5. Example — `pages/Checkout.tsx` (orchestration)

State:

```
contact: { email, firstName, lastName }
shipping: AddressDraft                 // prefilled (current Zürich defaults + customer name)
billingSameAsShipping: boolean         // default true
billing: AddressDraft
selectedModeId: string | null
```

- Logged-in → `useCustomerAddresses()` feeds both `AddressSection`s; pre-select
  the customer's default address when present.
- Toggle "billing address = shipping address" (default on). When off, render a
  second `AddressSection` for billing.
- Submit builds:
  - `addresses: [{ ...shipping, type: "SHIPPING" }, { ...(billingSameAsShipping ? shipping : billing), type: "BILLING" }]`
  - `paymentMethods: selectedModeId
      ? [{ provider: "payment-gateway", customAttributes: { modeId: selectedModeId }, amount }]
      : [{ provider: "custom", amount }]`  (fallback when no mode is available)
  - Customer identification, free shipping, order-placed screen, and the
    "Live order" warning stay unchanged.

### 6. Data flow

```
usePaymentModes ─▶ PaymentSelector ─▶ selectedModeId ─┐
useCustomerAddresses ─▶ AddressSection ─▶ shipping/billing draft ─┤
                                                                  ├─▶ Checkout.submit() ─▶ placeOrder
contact fields ──────────────────────────────────────────────────┘
```

### 7. Error handling

- Payment fetch empty or failed → silent fallback to `provider: "custom"`, shown
  as a muted note; checkout stays usable.
- Required fields: shipping always; billing only when the toggle is off.
- Live-order caveat: a real gateway mode sent without a token/redirect may land
  in a pending state server-side — acceptable for the demo and covered by the
  existing "Live order" warning.

## Testing & verification

- **SDK** `packages/sdk/tests/services/payment.test.ts`: add a test that
  `listPaymentModes` works with anonymous auth (the MSW setup already mocks the
  anonymous-login and the paymentmodes endpoint).
- **React**: add a test for `usePaymentModes` — returns modes with **no**
  customer token (anonymous) and with a token; the query key carries
  `authKind`.
- **Changesets**: one `patch` for `@viu/emporix-sdk` (listPaymentModes no longer
  requires a customer token), one `patch` for `@viu/emporix-sdk-react`
  (usePaymentModes works for anonymous sessions).
- **Example** (`@viu/emporix-examples-storefront-demo`): not unit-tested.
  Verify by building the packages first, then typechecking the example:
  `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build`
  then `pnpm -F @viu/emporix-examples-storefront-demo typecheck`.
  E2E (Playwright) is optional/manual and depends on the tenant having modes
  configured.

## Risks / open questions

- A configured gateway mode selected in the demo may produce a live order whose
  payment never completes (pending). Mitigated by the existing live-order
  warning; out of scope to fully resolve.
- Saved-address shapes from `useCustomerAddresses` are copied field-by-field into
  `AddressDraft`; any field the API omits simply stays blank in the form.
