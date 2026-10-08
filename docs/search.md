# Search Service

Bindings for the Emporix **Search Service** (`/search/{tenant}/…`): search the
documents of a custom schema type, store saved searches, and manage the search
indexes and the jobs that build them.

> **Preview.** Emporix marks the whole service as preview — "some of the
> features may not be fully operational yet" — and supports **custom schema
> types only** so far.
>
> **Server-side.** Defaults to the service (clientCredentials) token:
> `search.search_read` for reads and `search`, `search.search_manage` for
> writes. Searching also needs read access to the documents themselves
> (`schema.custominstance_read`, `custom.{type}_read` or
> `custom.{type}_read_own`), or it answers `403`.

## Indexes come first

A search names an index, so build one per type before you search. An index lists
the fields it makes searchable:

```ts
const job = await client.search.upsertIndex("vehicle", "vehicles", {
  name: { en: "Vehicles" },
  fields: [
    { path: "name.en", text: true, autocomplete: "PREFIX" },
    { path: "code", text: true, exact: true },
    { path: "mixins.brand.horsepower", exact: true },
  ],
});
// `{ id }` of the build job (202), or undefined (204) when nothing needed building
if (job) await client.search.getJob(job.id);
```

- `path` is the full stored path: `name.en`, not `name`. It must be a field of
  the schema type, `metadata.createdAt` or `metadata.modifiedAt`.
- A string field needs `text`, `autocomplete` or `exact`. Number, boolean and
  date fields take only `exact: true`. `time`, `list`, `object` and
  `dictionary` fields cannot be indexed.
- **Filter and sort fields must be indexed with `exact`**, or the search answers
  `400`.

`upsertIndex` starts a job (`202`) for a new index, for a changed field list, and
for an index whose status is `building` or `failed`. An index that is `ready`
with unchanged fields answers `204` and starts nothing; `name` and `description`
still change. `deleteIndex` also answers with a job id.

```ts
const indexes = await client.search.listIndexes({ type: "vehicle" });
const everyType = await client.search.listIndexes(); // each item carries `type`
const one = await client.search.getIndex("vehicle", "vehicles", { fields: "id,status" });
const jobs = await client.search.listJobs({ sort: "metadata.createdAt:DESC" });
await client.search.deleteIndex("vehicle", "vehicles");
```

## Searching

```ts
const page = await client.search.search(
  "vehicle",
  {
    index: "vehicles",
    queries: [{ type: "TEXT", query: "diesel", field: "name.en", fuzzy: { enabled: true, maxEdits: 1 } }],
    filters: { field: "mixins.brand.horsepower", operator: "BETWEEN", value: [120, 250] },
  },
  { pageSize: 20, sort: "code:ASC", totalCount: true }, // `code` is indexed with `exact`
);
// page.items: SearchHit[] — the stored document plus `id` and `_score`
```

- `queries` takes an array (any query matches), `{ and: [...] }` (every query
  matches) or `{ or: [...] }`. Match types: `TEXT`, `PHRASE`, `AUTOCOMPLETE`,
  `WILDCARD` (`*` and `?`; no fuzzy matching).
- `filters` narrow the matches without changing the score. Operators: `EQ`,
  `NEQ`, `GT`, `GTE`, `LT`, `LTE`, `BETWEEN` (two values, inclusive), `IN`,
  `NOT_IN` (non-empty array), `EXISTS` (boolean).
- Paging, `sort` and `fields` go in the query string, not the body; the SDK
  places them. Without `sort`, hits come ordered by relevance.

## Saved searches

A saved search stores an index, queries and filters under an id. Running it
replaces the text of every stored query:

```ts
const created = await client.search.upsertSavedSearch("vehicle", "red-cars", {
  name: { en: "Red cars" },
  index: "vehicles",
  queries: { type: "TEXT", query: "red", field: "name.en" },
});
// `{ id }` when created (201), undefined when it replaced one (204)

const hits = await client.search.search("vehicle", { searchQueryId: "red-cars", query: "diesel" });

const stored = await client.search.getSavedSearch("vehicle", "red-cars");
await client.search.upsertSavedSearch("vehicle", "red-cars", {
  index: "vehicles",
  queries: { type: "TEXT", query: "red", field: "name.en", boost: 2 },
  metadata: { version: stored.metadata?.version ?? 1 },
});
await client.search.deleteSavedSearch("vehicle", "red-cars");
```

Saving or deleting a saved search never starts an index build.

## Status codes that are easy to misread

| Call | Status | Meaning |
|---|---|---|
| `search` | `400` | a filter or sort field is not indexed — or `index` is missing, or the body has neither `queries` nor `filters` |
| `search` | `404` | only with `searchQueryId`: no saved search with that id for this type |
| `search` | `502` | the Schema Service could not confirm that the type is a custom entity |
| `upsertSavedSearch`, `upsertIndex` | `400` | an update without `metadata.version`; an `id` in the body that differs from the path |
| `upsertSavedSearch`, `upsertIndex` | `409` | a stale `metadata.version`; for an index also a job already running |
| `upsertSavedSearch` | `404` | `index` does not exist for this type |
| `deleteIndex` | `409` | a job is already running for this index |

The read methods use the client-wide `Accept-Language`
(`client.setStorefrontContext({ language })`); localized `name` and
`description` come back in that language.

`upsertIndex` and `upsertSavedSearch` send `Content-Language` when the client
sets `contentLanguage` (`EmporixConfig.contentLanguage`), and no header when it
does not. These methods take no per-call override. The spec reads the header as
the language of `name` and `description`, and every language key in those maps
must be configured for the tenant. Which value the preview service expects for a
map of translations has not been verified against a live tenant.

All methods take an optional trailing `auth` argument (default: the service
token).
