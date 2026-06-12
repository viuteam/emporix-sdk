---
"@viu/emporix-sdk": minor
---

fix the HTTP retry to never replay non-idempotent requests: POST/PATCH responses with 5xx/429 are no longer retried automatically (a 5xx can arrive after the server committed — retrying `placeOrder` could duplicate orders/charges). Read-only POST endpoints can opt back in via the new `RequestOptions.idempotent: true` flag. Numeric `Retry-After` waits are now capped at 8s. 5xx responses without a `Retry-After` header now back off exponentially instead of retrying immediately.
