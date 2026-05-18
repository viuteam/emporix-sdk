# Plan D — Generated Request-Type Bindings

Verified against `packages/sdk/src/generated/*/types.gen.ts` on 2026-05-18.

| Method | Generated request type | Public alias |
|---|---|---|
| `customers.signup` | `CustomerSignup` | `CustomerSignupInput` |
| `customers.login` | — (none) | keep literal `{ email; password }` |
| `customers.update` | `CustomerUpdateDto` | `CustomerUpdateInput` |
| `customers.changePassword` | `PasswordChangeDto` | `PasswordChangeInput` |
| `customers.requestPasswordReset` | `PasswordResetRequestDto` | `PasswordResetRequestInput` |
| `customers.confirmPasswordReset` | `PasswordUpdate` | `PasswordResetConfirmInput` |
| `customers.addresses.add` | `AddressCreateDto` | `AddressCreateInput` |
| `customers.addresses.update` | `AddressUpdateDto` | `AddressUpdateInput` |
| `carts.create` | `CreateCart` | `CreateCartInput` |
| `carts.addItem` | `CartItemRequest` | `CartItemInput` |
| `carts.updateItem` | `UpdateCartItem` | `CartItemUpdate` |
| `carts.applyCoupon` | — (none) | keep `code: string` param, body `{ code }` |
| `carts.setShippingAddress` / `setBillingAddress` | `AddressRequest` | `CartAddress` |
| `checkout.placeOrder` | `RequestCheckout` | `CheckoutInput` |
| `checkout.placeOrderFromQuote` | `RequestFromQuoteCheckout` | `QuoteCheckoutInput` |
| `payments.authorize` | `AuthorizePaymentRequest` | `AuthorizePaymentInput` |

## Exact top-level field shapes

**CustomerSignup**: `email: string`, `password: string`, `customerDetails?: CustomerUpdateDto`, `customerAddress?: Address`, `signup?: PasswordAuthentication`

**CustomerUpdateDto** = `CustomerCommonDto & {…}` (intersection — pass through verbatim).

**PasswordChangeDto**: `currentPassword: string`, `newPassword: string`
→ replaces the old `{ old, new }` wrapper. Callers now send `{ currentPassword, newPassword }`.

**PasswordResetRequestDto**: `email: string`, `site?: string`

**PasswordUpdate**: `token: string`, **`password: string`** (NOT `newPassword`)
→ replaces old `{ token, newPassword }`. Callers now send `{ token, password }`.

**AddressCreateDto**: all optional — `contactName?`, `companyName?`, `street?`, `streetNumber?`, `streetAppendix?`, `extraLine1..4?`, `zipCode?`, `city?`, `country?`, `state?`, `contactPhone?`, `tags?`, `metadata?`, `mixins?`

**AddressUpdateDto** = `AddressCommonDto & {…}` (intersection).

**CreateCart**: `currency: string` (**required**), `customerId?`, `restriction?`, `legalEntityId?`, `deliveryWindowId?`, `deliveryWindow?`, `siteCode?` (+ more, all optional). The old `{ currency?, siteCode? }` becomes this; `currency` is now required by the type.

**CartItemRequest**: `id?`, `keepAsSeparateLineItem?`, `product?: Product & {…}`, `itemYrn?`, `externalFees?`, `externalDiscounts?`, `itemType?`, `quantity?` — NOT `{ productId, quantity }`.

**UpdateCartItem**: `externalFees?`, `externalDiscounts?`, `product?`, `itemYrn?`, `itemType?`, `quantity?: number`, `taxCode?`, `tax?` — NOT `{ quantity? }` only.

**AddressRequest**: `contactName?`, `companyName?`, `street?`, `streetNumber?`, `streetAppendix?`, … (all optional).

**RequestCheckout**: `cartId: string`, `paymentMethods: RequestPaymentMethodJson[]`, `currency?`, `shipping: ShippingJson`, `addresses: AddressJson[]`, `customer: CustomerJson`. `CustomerJson` has `guest?: boolean` — so `isGuest(input.customer)` reading `.guest` still works unchanged.

**RequestFromQuoteCheckout**: `quoteId: string`, `paymentMethods: RequestPaymentMethodJson[]`, `deliveryWindowId?`

**AuthorizePaymentRequest** = `InitializePaymentRequest & AuthorizeFrontendPaymentRequest & { amountToAuthorize?, currency? }`.
`InitializePaymentRequest`: `order?: { id… }`, `paymentModeId?: string`, `creditCardToken?: string`.
→ This is exactly the body the facade currently *constructs* (`{ order: { id }, paymentModeId, creditCardToken? }`). Dropping the construction means callers pass `{ order: { id }, paymentModeId, … }` directly.

## Standing exception

`CustomerService.login` has no generated request type — keep the literal
`{ email; password }` input. Its snake_case `CustomerSession` **response**
mapping is unchanged (documented prior bug fix). See
[[generated-types-request-and-response]].
