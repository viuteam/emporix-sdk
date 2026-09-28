---
"@viu/emporix-sdk-react": major
"@viu/emporix-sdk-angular": minor
---

feat(react): read the customer's segments from `GET /segments/me`

`useMySegments` (React) and `injectMySegments` (Angular) now call
`client.segments.listMine` instead of `client.segments.list`. The result type is
unchanged; **the data may differ**:

- segments inherited through the customer's IAM groups are included — groups not
  bound to a legal entity, and groups bound to the customer's current one;
- only **active** segments are returned.

The generic `GET /segments` the hooks used before does not document either
behaviour for a customer token, while `/segments/me` is the endpoint Emporix
documents for "the authenticated customer's segments" since 2026-09-16.

A B2B company switch (`setActiveCompany`) now also invalidates every segment
read — `useMySegments`, the item/product/category hooks and their Angular
counterparts. Membership follows the legal entity, directly and through groups
bound to it, yet a switch used to keep serving the previous company's segments
until they went stale (five minutes). Both hooks also accept `sort` now.
