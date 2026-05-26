---
"@viu/emporix-sdk": minor
---

B2B foundation:

- New `client.companies` / `client.contacts` / `client.locations` services over Customer Management (legal entities, contact assignments, locations).
- New `client.customerGroups` (read-only) over IAM (groups filtered by `b2b.legalEntityId`).
- New `EmporixInsufficientScopeError` subclass of `EmporixForbiddenError`, surfaced from 403 responses that carry a `missing scope: …` detail. Carries `requiredScope`.
- New `ServiceName` entries `"customer-management"` and `"iam"` for logger scoping.

No breaking changes. Existing `cart.getCurrent({ legalEntityId })` and `customer.refresh({ legalEntityId })` are now exercised in tests.
