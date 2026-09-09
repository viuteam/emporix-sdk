# Indexing Service

Bindings for the Emporix **Indexing Service** (`/indexing/{tenant}/…`):
search-index provider configurations and reindex.

> **Server-side.** Defaults to the service (clientCredentials) token
> (`indexing.search_view` / `indexing.search_manage`).

```ts
const configs = await client.indexing.listConfigurations();
const algolia = await client.indexing.getConfiguration("algolia");
await client.indexing.createConfiguration({ provider: "algolia", /* … */ });
await client.indexing.updateConfiguration("algolia", { /* … */ });
await client.indexing.deleteConfiguration("algolia");

// public (read) configurations
await client.indexing.listPublicConfigurations();
await client.indexing.getPublicConfiguration("algolia");
```

## Reindex jobs

`createReindexJob` replaces the deprecated `reindex()` (removal 2026-12-01)
because it returns a job you can poll:

```ts
const job = await client.indexing.createReindexJob({ entityType: "PRODUCT", rag: true });
// 201 with the new job, or 200 with the job already IN_PROGRESS for that entityType

const page = await client.indexing.listReindexJobs({
  pageSize: 20,
  sort: "metadata.createdAt:desc",
  totalCount: true, // sent as the X-Total-Count request header, not a query param
});
const one = await client.indexing.getReindexJob("6a31424ef4ddd37d108f8168");
```

Every field on `ReindexJob` is optional in the spec, `id` included — so narrow
before you poll:

```ts
if (job.id) await client.indexing.getReindexJob(job.id);
```

## `BATTERY_INCLUDED`: a 400 may be about your credentials

On the `BATTERY_INCLUDED` provider every write validates the stored `indexName`
and `writeKey` against the search backend **before** it takes effect:

| Case | Status | Effect |
|---|---|---|
| credentials invalid | `400` | nothing written, no job created |
| validation unreachable | `502` | nothing written, no job created |

That applies to `createConfiguration`, `updateConfiguration`, `reindex`, and to
`createReindexJob` when `entityType` is `PRODUCT`. So a `400` from these calls
is not necessarily a malformed body — check the write key first.

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
