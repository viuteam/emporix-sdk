---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat(sdk): generate IAM types, add group member mutations

Replaces the last hand-written `generated/` mirror (`iam`) with codegen from the
vendored "IAM Service" spec, so `customerGroups.listForCompany` returns the real
group shape (`GroupsQueryDocument` — note: the wire uses `code`/`userType`, not
the previously-mirrored `role`, which never existed on the API). Ships the
previously-deferred group member mutations now that the endpoints are confirmed:
`customerGroups.addMember` / `removeMember`, plus the `useAddGroupMember` /
`useRemoveGroupMember` React hooks. No hand-written generated mirrors remain.
