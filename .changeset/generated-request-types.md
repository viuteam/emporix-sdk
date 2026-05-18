---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

BREAKING: every service request body now uses the generated OpenAPI request
type. `carts.create` takes `CreateCart`, `carts.addItem` takes
`CartItemRequest` (now requires `product`/`quantity`/`price`),
`carts.updateItem` takes `UpdateCartItem`, `checkout.placeOrder` takes
`RequestCheckout`, `checkout.placeOrderFromQuote` takes
`RequestFromQuoteCheckout`, `payments.authorize` takes
`AuthorizePaymentRequest` (`{ order: { id }, … }`),
`customers.changePassword` takes `{ currentPassword, newPassword }`,
`customers.confirmPasswordReset` takes `{ token, password }`,
`customers.signup`/`update`/`addresses.*` take the generated DTOs. All
ergonomic input wrappers and input transformations are removed — callers
send the exact wire shape. `useCartMutations.addItem`/`updateItem` mutation
variables change accordingly. `CustomerService.login` keeps its literal
`{ email, password }` input and snake_case `CustomerSession` response (no
generated request type exists for it).
