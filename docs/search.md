# Search Service

Bindings for the Emporix **Search Service** (`/search/{tenant}/…`): search the
documents of one type — a custom schema type, `customer` or `legal-entity` —
store saved searches, and manage the search indexes and the jobs that build
them.

> **Preview.** Emporix marks the whole service as preview — "some of the
> features may not be fully operational yet".
>
> **Server-side.** Defaults to the service (clientCredentials) token:
> `search.search_read` for reads and `search`, `search.search_manage` for
> writes. Searching also needs read access to the documents themselves, or it
> answers `403` — see [Types and scopes](#types-and-scopes).

## Types and scopes

Every method takes a `type`. Since 2026-10-29 that is a custom schema type,
`customer` or `legal-entity`:

| `type` | Read access the search also needs |
|---|---|
| a custom schema type, such as `VEHICLE` | `schema.custominstance_read`, `custom.{type}_read` or `custom.{type}_read_own` |
| `customer` | `customer.customer_read` or `customer.customer_read_own` |
| `legal-entity` | `customermanagement.legalentity_read` or `customermanagement.legalentity_read_own` |

For `customer` and `legal-entity` the scope also decides **which documents come
back**:

- The unrestricted read scope returns every document.
- A site-restricted read scope, such as `customer.customer_read--DE#AT`, returns
  only the documents whose `restriction` (customer) or `restrictions` (legal
  entity) contains one of the listed values. A restricted scope with no values
  answers `403`.
- The own-read scope returns only the caller's own customer or legal entity; a
  token that identifies neither answers `403`.
- With both a restricted and an own scope, a document must match both.

A custom type is written as the Schema Service stores it — upstream's examples
use upper case (`VEHICLE`). The two built-in types are lower case.

## Indexes come first

A search names an index, so build one per type before you search. An index lists
the fields it makes searchable:

```ts
const job = await client.search.upsertIndex("VEHICLE", "vehicles", {
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
  the type, `metadata.createdAt` or `metadata.modifiedAt`.
- A string field needs `text`, `autocomplete` or `exact`. Number, boolean and
  date fields take only `exact: true`. `time`, `object` and `dictionary` fields
  cannot be indexed; a list of objects is indexed through `itemFields` (below).
- **Filter and sort fields must be indexed with `exact`** — except for the
  `CONTAINS` filter, which needs `text: true` — or the search answers `400`.

### Analyzers and lists of objects

Since 2026-10-29 an index decides how text is compared, and can index a list of
objects so that conditions match within one list item:

```ts
// Field paths as in upstream's example — check them against your documents.
await client.search.upsertIndex("legal-entity", "companies", {
  analyzers: [
    { name: "companyName", basedOn: "FOLDED", ignoreCharacters: ["."], ignoreWords: ["gmbh", "ag"] },
  ],
  fields: [
    { path: "name", text: true, analyzer: "companyName", additionalAnalyzers: ["SOUNDS_LIKE"] },
    {
      path: "addresses",
      itemFields: [
        { path: "addresses.street", text: true, analyzer: "FOLDED" },
        { path: "addresses.zipCode", text: true, analyzer: "IDENTIFIER" },
      ],
    },
  ],
});

await client.search.search("legal-entity", {
  index: "companies",
  queries: [{ type: "TEXT", query: "mueller", field: "name", analyzer: "SOUNDS_LIKE" }],
});
```

- **Presets:** `STANDARD` compares words and ignores case (the default),
  `FOLDED` also ignores accents, `IDENTIFIER` compares the whole value and drops
  spaces, `-`, `.` and `/`, `SOUNDS_LIKE` matches words that sound alike.
- A field with `text: true` takes one `analyzer` — a preset or the `name` of an
  analyzer on the index — and up to three `additionalAnalyzers`, which a query
  uses only when it names one. A `TEXT` or `PHRASE` query may set `analyzer` to
  either.
- An index holds at most ten named `analyzers` (`SearchIndexAnalyzer`), and
  every one must be used by a field — otherwise `400` «Analyzer '…' is not
  used.». Names start with a letter; preset names, `keyword` and `folded` are
  reserved.
- **A list of objects** is declared on its own path with `itemFields`; its
  children use the full path (`addresses.city`), and the list itself carries no
  `text`, `autocomplete`, `exact` or `analyzer`. A child declared outside
  `itemFields` answers `400`. Conditions on one list joined by `and` must match
  the **same** item.

`upsertIndex` starts a job (`202`) for a new index, for a changed field list, and
for an index whose status is `building` or `failed`. An index that is `ready`
with unchanged fields answers `204` and starts nothing; `name` and `description`
still change. `deleteIndex` also answers with a job id.

`metadata` can be left out on an update as well. When `metadata.version` is
sent, it is an optimistic lock, and a stale one answers `409`.

```ts
const indexes = await client.search.listIndexes({ type: "VEHICLE" });
const everyType = await client.search.listIndexes(); // each item carries `type`
const one = await client.search.getIndex("VEHICLE", "vehicles", { fields: "id,status" });
const jobs = await client.search.listJobs({ sort: "metadata.createdAt:DESC" });
await client.search.deleteIndex("VEHICLE", "vehicles");
```

### Copying indexes to another tenant

`exportIndexes` packs the configuration of the selected indexes; `importIndexes`
creates or updates each of them, typically on another tenant:

```ts
const pkg = await source.search.exportIndexes([
  { type: "VEHICLE", id: "vehicles" },
  { type: "BIKE", id: "bikes" },
]);
const results = await target.search.importIndexes(pkg);
// one result per index, in package order: { id, type, jobId?, jobType? }
```

- `pkg.data` is a base64-encoded JSON array of `{ id, type, fields, name?,
  description? }`. Pass the package on unchanged; it carries no `status` and no
  `metadata`.
- Export answers `404` when a selected index does not exist and `400` for an
  empty selection.
- Import runs the same checks as `upsertIndex`, so the type must exist on the
  target tenant with the indexed fields.
- **Import is not atomic.** When an index fails, the ones before it in the
  package stay created or updated, and the call throws only that index's error.
  Use `listIndexes` on the target to see what arrived.

## Searching

```ts
const page = await client.search.search(
  "VEHICLE",
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
  `NOT_IN` (non-empty array), `EXISTS` (boolean), `CONTAINS` (see below).
- `CONTAINS` matches a substring, ignoring case and diacritics:
  `{ field: "name.en", operator: "CONTAINS", value: "hybrid-9" }`. The value
  must not be blank, and the field needs `text: true` in the index. The service
  wraps the value in `*` and escapes `\`, `*` and `?` in it, so pass the plain
  text; spaces stay part of the value.
- Paging, `sort` and `fields` go in the query string, not the body; the SDK
  places them. Without `sort`, hits come ordered by relevance.

## Saved searches

A saved search stores an index, queries and filters under an id. Running it
replaces the text of every stored query:

```ts
const created = await client.search.upsertSavedSearch("VEHICLE", "red-cars", {
  name: { en: "Red cars" },
  index: "vehicles",
  queries: { type: "TEXT", query: "red", field: "name.en" },
});
// `{ id }` when created (201), undefined when it replaced one (204)

const hits = await client.search.search("VEHICLE", { searchQueryId: "red-cars", query: "diesel" });

const stored = await client.search.getSavedSearch("VEHICLE", "red-cars");
await client.search.upsertSavedSearch("VEHICLE", "red-cars", {
  index: "vehicles",
  queries: { type: "TEXT", query: "red", field: "name.en", boost: 2 },
  metadata: { version: stored.metadata?.version ?? 1 },
});
await client.search.deleteSavedSearch("VEHICLE", "red-cars");
```

Saving or deleting a saved search never starts an index build.

## Status codes that are easy to misread

| Call | Status | Meaning |
|---|---|---|
| `search` | `400` | a filter or sort field is not indexed — or `index` is missing, the body has neither `queries` nor `filters`, or a query names an `analyzer` the field does not have |
| `search` | `403` | no read access to the documents of this type, a site-restricted scope with no values, or an own scope whose token identifies no customer or legal entity |
| `search` | `404` | only with `searchQueryId`: no saved search with that id for this type |
| `search` | `502` | for a custom type: the Schema Service could not confirm that the type is a custom entity |
| `upsertSavedSearch` | `400` | an update without `metadata.version`; an `id` in the body that differs from the path |
| `upsertIndex` | `400` | an `id` in the body that differs from the path; `metadata.version` below 1; an analyzer no field uses; a list child outside `itemFields` |
| `upsertSavedSearch`, `upsertIndex`, `importIndexes` | `409` | a stale `metadata.version`; for an index also a job already running |
| `exportIndexes` | `404` | one of the selected indexes does not exist |
| `importIndexes` | `400` | an unreadable package, or an index that fails validation; the indexes before it are already written |
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
