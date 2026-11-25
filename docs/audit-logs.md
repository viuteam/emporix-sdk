# Audit Logs

Bindings for the Emporix **Audit Logs (Changelog) Service**
(`/changelog/{tenant}/changelogs`): tenant-wide change history for platform
entities — who changed what, when, and from which value to which.

> **Server-side.** Defaults to the service (clientCredentials) token and needs
> the `changelog.changelog_read` scope (`changelog.changelog_manage` also grants
> it). There is no customer or anonymous variant, so `@viu/emporix-sdk-react`
> ships no hooks for it — call it from Node, a Next Route Handler or a Server
> Action, never from a browser bundle.

> **Preview upstream.** Emporix marks the whole service as preview: the contract
> may change without a major version bump, and nearly every field of an entry is
> optional in the spec. Read them defensively.

```ts
const page = await client.auditLogs.list({ q: "entity:order" });

for (const entry of page.items) {
  console.log(entry.at, entry.type, entry.actor, entry.paths);
}
```

## The two things that will bite you

**The window silently defaults to the last 7 days.** When your `q` carries no
`occurredAt` lower bound outside an `OR` condition, the service applies a
trailing 7-day window on its own, in offset and in cursor mode alike. An
unfiltered `list()` is *not* «everything ever» — it is «the last week», and
nothing in the response says so. Pass an explicit top-level or `AND`-ed range to
widen it:

```ts
await client.auditLogs.list({
  q: 'occurredAt:(>"2026-01-01T00:00:00.000Z" AND <"2026-07-01T00:00:00.000Z")',
});
```

An `occurredAt` that appears only inside an `OR` arm does **not** lift the
default.

> **Changed upstream.** Until the spec vendored on 2026-11-24, the default
> window was 30 days. Code that relied on an unfiltered call covering the last
> month now sees only the last week — add an explicit `occurredAt` bound.

**`entityId` requires `entity`.** Filtering by id alone is a `400`, not an empty
page. There is also no path-based history endpoint — scoping to one document
means naming both:

```ts
// The history of one order.
await client.auditLogs.list({ q: `entity:order entityId:${orderId}` });
```

## Filtering

`q` is the raw Emporix query string, passed through verbatim. Supported fields:

| Field | Example |
|---|---|
| `entity` | `entity:order` |
| `entityId` (requires `entity`) | `entity:order entityId:6a2bce93592855a33518fc2f` |
| `type` | `type:update` — one of `create`, `update`, `delete` |
| `actor` | `actor:system`, glob `actor:John*`, regex `actor:~^sys` |
| `occurredAt` | `occurredAt:(>"2026-06-01T00:00:00.000Z" AND <"2026-06-30T23:59:59.999Z")` |
| `related.entity` / `related.entityId` | `related.entity:group related.entityId:1gr5e…` |
| `related:elemMatch(…)` | `related:elemMatch(entity:group entityId:1gr5e…)` |
| `compoundLogicalQuery` | `compoundLogicalQuery:((entity:group type:update) OR (related:elemMatch(entity:group)))` |

`entity` accepts the built-in types (`order`, `customer`, `company`, `product`,
`segment`, `group`, `group-assignment`, `coupon`) as well as custom entities
created with the [Schema Service](./schema.md).

Unlike `client.orders.list` or `client.products.search`, this `q` is a plain
`string` and **not** a `QueryFor<E>` mixin filter. A `MixinFilter` targets an
entity's own fields, and this endpoint indexes change *metadata* rather than the
document — a filter built for `"ORDER"` would name fields the changelog does not
have.

## What an entry looks like

```ts
{
  at: "2026-06-01T13:01:29.123Z",
  type: "update",
  entity: "order",
  entityId: "6a2bce93592855a33518fc2f",
  paths: { status: { before: "CREATED", after: "CONFIRMED" } },
  schemaVersion: "v2",
  actor: "John Doe",
}
```

`paths` is a flat map of changed field path → `{ before?, after? }`, derived
from the change patch. Both sides are `unknown`, and either can be absent —
`before` on a create, `after` on a delete, or both when the service could not
derive them.

`actor` is a display name, not an id: a person's name, or the special values
`system`, `external`, `unknown`.

`related` carries the junction-style links that make a change findable from
either side — a `group-assignment` relates to both its `group` and its
`customer`:

```ts
await client.auditLogs.list({
  q: "related:elemMatch(entity:group entityId:1gr5e52e-6e27-4ac5-9471-2467d3fb7501)",
});
```

## Paging

The endpoint pages in two modes, and the SDK gives each its own method because
the results have different shapes:

| | `list` (offset) | `listByCursor` (cursor) |
|---|---|---|
| Wire | `page` + `size` | `pagination=cursor`, `size`, `next` / `prev` |
| Totals | `totalElements`, `totalPages` | none — the service does not count |
| Next page | `pageNumber + 1` | `nextCursor` (older entries) |
| Previous page | `pageNumber - 1` | `prevCursor` (newer entries) |

### Offset mode — `list`

Paging is one-based, and this service returns it in the **response body** rather
than in `X-Total-Count` headers. The result therefore carries `totalElements`
and `totalPages` on top of the usual [`PaginatedItems`](./pagination.md) shape —
the same treatment `ImportPage` gets, for the same reason.

```ts
const page = await client.auditLogs.list({ pageNumber: 2, pageSize: 100 });
page.pageNumber;    // 2
page.pageSize;      // 100 — echoed by the server, not what you asked for
page.hasNextPage;   // pageNumber < totalPages
page.totalElements; // absolute match count, always returned here
page.totalPages;
```

`pageSize` maxes out at **100**; the service answers a larger value with a `400`
rather than clamping it. `pageNumber` / `pageSize` are read back from the
server's echo, so they describe the page you actually got.

To walk every page, use the shared `iterateAll` helper — but bound the range
first, or you are iterating the implicit 7-day window:

```ts
import { iterateAll } from "@viu/emporix-sdk";

const q = `entity:order occurredAt:(>"2026-06-01T00:00:00.000Z")`;
for await (const entry of iterateAll((pageNumber) =>
  client.auditLogs.list({ q, pageNumber, pageSize: 100 }),
)) {
  // …
}
```

### Cursor mode — `listByCursor`

For long histories where you only walk the entries and do not need the count,
cursor mode skips the counting query. Entries come newest first, ordered by
`occurredAt` and then by an internal event id, so ties stay in a stable order
across pages.

```ts
const q = 'entity:order occurredAt:>"2026-06-01T00:00:00.000Z"';
let page = await client.auditLogs.listByCursor({ q, pageSize: 100 });
for (;;) {
  for (const entry of page.items) console.log(entry.at, entry.actor);
  if (page.nextCursor === undefined) break;
  page = await client.auditLogs.listByCursor({ q, pageSize: 100, next: page.nextCursor });
}
```

The traps:

| Trap | What happens |
|---|---|
| Changing `q` or `pageSize` between cursor requests | `400` — a cursor is bound to the tenant, `q` and `size` it was issued for |
| Sending `next` and `prev` together | `400` |
| A malformed or stale cursor | `400` — request the first page again without a cursor |
| Expecting new entries on later pages | Without an `occurredAt` upper bound in `q`, the window ends at the time of the first request; newer entries need a new first page |
| Looking for `prevCursor` on the first page | Never set there; it appears from the second page on |

`hasNextPage` is `true` exactly when `nextCursor` is set. Unlike the shared
`PaginatedItems` contract, the absence of the cursor does mean «no older
entries» here, because the service always sends the header in cursor mode when
an older page exists. An empty page carries neither cursor.

## What is not verified against a live tenant

The bindings are covered by unit tests against the vendored spec, not by a call
to a real tenant: the service needs a backend client with the
`changelog.changelog_read` scope, which the `viu` tenant's test credentials do
not carry. Unverified in particular are the exact `q` grammar the backend
accepts (quoting, `elemMatch`, nested `compoundLogicalQuery`), the real shape of
`paths` for nested documents, the 7-day default window, and cursor mode
(`listByCursor`: the `pagination=cursor` parameter, the `x-next-cursor` /
`x-prev-cursor` headers and the `400` cases) — all of them are described here
from the spec's own prose.
