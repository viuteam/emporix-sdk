---
"@viu/emporix-sdk": minor
---

feat(sdk): wrap the two operations an audit found unwrapped

An operation-by-operation audit of all 44 vendored specs found the SDK covering
every non-deprecated operation except two. Both are now wrapped:

- **`client.customers.validateToken(auth)`** — `GET /customer/{tenant}/validateauthtoken`.
  Reports what a customer token carries: `scope`, `sessionId`, `email`,
  `legalEntityId`, `expires_in`. A check rather than a predicate — an invalid
  token answers `401`, which surfaces as `EmporixAuthError`. Useful when the
  token came from elsewhere (an SSO exchange, a Managed Dashboard host) and you
  need its scopes before deciding what to render.
- **`client.iam.users.getGroup(userId, groupId, auth)`** —
  `GET /iam/{tenant}/users/{userId}/groups/{groupId}`. The collection read
  (`users.getGroups`) was already there; the item read was not, so a caller
  holding both ids had to page the collection to resolve one group.

`SessionContextService`'s doc comment now states which operations it
deliberately does **not** wrap and why: Emporix exposes the same four
session-context operations addressed by an explicit session id, which lets a
caller read and rewrite someone else's session. That is an administrative
surface and does not belong on the object a storefront holds.

No behaviour changes to existing methods.
