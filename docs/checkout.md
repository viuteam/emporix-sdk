# Checkout & Payment

## Triggering a checkout

`POST /checkout/{tenant}/checkouts/order` is **atomic**: it validates the
checkout + cart, creates an order, handles the payment, and closes the cart.
It either fully succeeds or fails with a detailed validation error you can act
on and retry.

```ts
const session = await sdk.customers.login({ email, password }); // → customerToken, saasToken
const result = await sdk.checkout.placeOrder(
  {
    cartId: cart.id,
    currency: "EUR",
    customer: { email, id: customerId },           // id required for logged-in
    shipping: { methodId, zoneId, methodName: "DHL", amount: 0 },
    addresses: [
      { contactName, street, zipCode, city, country, type: "SHIPPING" },
      { contactName, street, zipCode, city, country, type: "BILLING" },
    ],
    paymentMethods: [{ provider: "none", method: "invoice" }], // exactly ONE
  },
  auth.customer(session.customerToken),
  { saasToken: session.saasToken, siteCode: "DE" },
);
// → { orderId, paymentDetails, checkoutId }
```

- **`saas-token` header** is mandatory for a logged-in customer checkout. It is
  the `saasToken` from `customers.login()` (a JWT with customer data) and is
  passed via `CheckoutOptions.saasToken`. The SDK redacts it from all logs.
- **Guest checkout:** set `customer.guest = true` and use
  `auth.anonymous()`; the `saas-token` header is then omitted automatically.
- **`siteCode`** is sent as `?siteCode=`.
- **Quote checkout:** `sdk.checkout.placeOrderFromQuote({ quoteId,
  paymentMethods, deliveryWindowId? }, auth, opts)`.
- **Auth:** `customer`/`raw` required (or `anonymous` for guest); the SDK throws
  `EmporixAuthError` before the request otherwise.
- **409:** delivery-window capacity exhausted, or an order already exists for
  that `cartId` — surfaces as a typed `EmporixError` (status 409).

## Payment provider variants

| `provider` | Behaviour |
| --- | --- |
| `none` | Cash / invoice — no gateway. |
| `custom` | Order created with status `IN_CHECKOUT`. |
| `payment-gateway` (in-checkout) | Payment authorised during checkout; `paymentDetails` may contain `externalPaymentRedirectURL` (redirect the user, e.g. PayPal). |
| `payment-gateway` + `customAttributes.deferred: true` (post-checkout) | Order placed without payment; authorise afterwards (below). |

`paymentDetails` is returned **verbatim** (`Record<string, unknown> | null`) —
inspect `externalPaymentRedirectURL`/`externalPaymentHttpMethod` to continue an
external payment.

## Post-checkout (deferred) payment

```ts
const modes = await sdk.payments.listPaymentModes(auth.customer(token));
const res = await sdk.payments.authorize(
  { orderId, paymentModeId: modes[0].id, creditCardToken },
  auth.customer(token),
);
// → { successful, paymentTransactionId, authorizationToken,
//     requiresExternalPayment, externalPaymentRedirectURL?, externalPaymentHttpMethod? }
```

If `requiresExternalPayment` is true, redirect the user to
`externalPaymentRedirectURL` to complete payment.

## React

```tsx
const { placeOrder, placeOrderFromQuote } = useCheckout();
const modes = usePaymentModes();           // logged-in customer only

await placeOrder.mutateAsync({ input, saasToken, siteCode });
```

`useCheckout` uses the customer token from `TokenStorage`; pass `saasToken`
(from `useCustomerSession`/`customers.login`) per call. See
[`examples/next-app-router/app/checkout`](../examples/next-app-router/app/checkout).

## Scope

The SDK provides the checkout call, the `paymentDetails` passthrough, payment
modes and the deferred `authorize` seam. Provider-specific flows (3DS2, PayPal
callbacks, webhook reconciliation) are the integrator's responsibility.
