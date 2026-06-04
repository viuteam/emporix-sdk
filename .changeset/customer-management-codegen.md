---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat(sdk): generate customer-management types from the real OpenAPI spec

Replaces the hand-written customer-management mirror (B2B legal-entities /
contact-assignments / locations) with codegen output from the vendored
"Customer Management Service" spec, so Companies/Contacts/Locations return the
real API shape. The `update` methods (and the matching `useUpdateCompany` /
`useUpdateContactAssignment` / `useUpdateLocation` hooks) now type their PATCH
body as `Partial<*Update>` to reflect the partial-update endpoint. `LegalEntity.id`
and sibling ids are optional in the generated shape, matching the wire contract.
