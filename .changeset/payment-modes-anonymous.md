---
"@viu/emporix-sdk": patch
---

`client.payments.listPaymentModes` no longer requires a customer token. It now
defaults to an anonymous context, matching the public frontend payment-modes
endpoint (which needs a bearer token but no customer scope), so storefronts can
list configured payment modes for guests as well as logged-in customers.
