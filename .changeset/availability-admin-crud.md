---
"@viu/emporix-sdk": minor
---

Add availability admin operations to `client.availability`: `listForSite`
(paginated per-site listing), per-product `create`/`update`/`delete`, and
`bulkCreate`/`bulkUpdate`/`bulkDelete` (207 Multi-Status — inspect each entry;
the bulk delete carries a body). Writes default to service auth. The bulk
methods accept `{ vendorId }`, sent as the `vendor-id` header — note the OpenAPI
schema spells it `venodr-id`, an apparent upstream typo, and the corrected name
is not yet verified against the live API. The deprecated location-management
endpoints remain unwrapped, and the existing reads are unchanged.
