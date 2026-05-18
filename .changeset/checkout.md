---
"@viu/emporix-sdk": minor
---

Add CheckoutService (cart and quote checkout, `saas-token` header, guest
checkout, `siteCode`) and PaymentGatewayService (frontend payment modes,
post-checkout deferred authorize). HttpClient gains per-request `headers`;
`saas-token` is added to the redaction floor. New subpath exports
`@viu/emporix-sdk/checkout` and `@viu/emporix-sdk/payment`.
