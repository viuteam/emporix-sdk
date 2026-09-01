---
"@viu/emporix-sdk": minor
---

feat(sdk): add the audit log (changelog) service

Emporix's **Audit Logs (Changelog) Service** was never in the spec registry.
It is now vendored, generated and wrapped as `client.auditLogs` — tenant-wide
change history for platform entities: who changed what, when, and from which
value to which.

```ts
const page = await client.auditLogs.list({ q: `entity:order entityId:${orderId}` });
for (const entry of page.items) {
  console.log(entry.at, entry.actor, entry.paths); // { status: { before, after } }
}
```

The whole upstream surface is **one paginated read**
(`GET /changelog/{tenant}/changelogs`), so the facade is one method.

**Service-account only**, on the `changelog.changelog_read` scope
(`changelog.changelog_manage` also grants it). There is no customer or anonymous
variant, so `@viu/emporix-sdk-react` and `@viu/emporix-sdk-angular` ship no
bindings for it — call it from a server.

Two behaviours the spec documents in prose rather than in its schema, and which
the JSDoc and [`docs/audit-logs.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/audit-logs.md)
now repeat where you will actually read them:

- **The window defaults to the last 30 days.** A query with no conjunctive
  `occurredAt` lower bound gets a silent trailing 30-day window, so an
  unfiltered `list()` is «the last month», not «everything ever». An
  `occurredAt` that appears only inside an `OR` arm does not lift it.
- **`entityId` requires `entity`.** Filtering by id alone is a `400`, not an
  empty page — and there is no path-based history endpoint, so scoping to one
  document means naming both in `q`.

Paging is one-based and arrives in the response body rather than in
`X-Total-Count` headers, so `AuditLogPage` carries `totalElements` and
`totalPages` on top of the usual `PaginatedItems` shape — the same treatment
`ImportPage` gets. `pageSize` maxes out at 100; the service answers a larger
value with a `400` instead of clamping it.

`q` is a plain `string` here, deliberately not a `QueryFor<E>` mixin filter: a
`MixinFilter` targets an entity's own fields, and this endpoint indexes change
metadata rather than the document.

Upstream marks the service as preview — the contract may change without a major
version bump, and nearly every field of an entry is optional in the spec.
