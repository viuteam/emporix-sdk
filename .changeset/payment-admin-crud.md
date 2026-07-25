---
"@viu/emporix-sdk": minor
---

Add the payment admin surface to `client.payments`. New `payments.modes`
sub-resource for payment-mode configuration (`list`/`get`/`create`/`update`/`delete`
against `/paymentmodes/config`), and new `payments.transactions` sub-resource for
the backend lifecycle: `list`, `get`, `authorize` (backend counterpart of the
storefront `authorize`), `capture`, `refund`, and `cancel`. All new methods
default to service auth. Note that these endpoints report business failures in
the 200 response body (`successful: false`), not as HTTP errors. The existing
storefront methods are unchanged.
