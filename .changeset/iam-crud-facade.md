---
"@viu/emporix-sdk": minor
---

Add `client.iam` — a CRUD facade for the current IAM admin surface: `iam.users`
(list/create/get/getMe/update/delete + group/scope/access-control reads),
`iam.groups` (CRUD + membership + access-controls), `iam.accessControls`
(list/get/upsert/delete), `iam.scopes` (list/get/upsertCustom/deleteCustom).
Every method takes a required `auth`. `client.customerGroups` now delegates its
list/add operations to `iam.groups` (public API unchanged). The deprecated
legacy-RBAC model (roles/permissions/resources/templates) is not wrapped.
