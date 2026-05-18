---
"@viu/emporix-sdk": minor
---

BREAKING: service methods now return the generated OpenAPI types instead of
the simplified hand-rolled interfaces. `Product`, `Cart`, `Category`,
`CategoryNode`, `CheckoutResult`, `PaymentMode`, `Customer`, and `Address`
are now type aliases over the generated schemas, so all API fields are typed
and available. Code that relied on the previous narrow shapes may need to
adjust field access — notably `Customer.email` is now `Customer.contactEmail`,
`Cart.items` / `Product.id` are optional per the spec, and product `name` is a
localized object. `CustomerService.login` / `CustomerSession` are unchanged
(the login wire is snake_case; camelCase is deprecated).
