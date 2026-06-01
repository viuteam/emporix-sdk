# AI RAG Indexer

Bindings for the Emporix **AI RAG Indexer** (`/ai-rag-indexer/{tenant}/{type}`),
which maintains the vector index backing AI/RAG features. Exposed as
`client.ragIndexer`. Read-and-trigger only: discover the embedded / filterable
fields, and kick off a full rebuild.

> **Server-side only.** Reads require the backend `ai.agent_read` scope and
> `reindex` requires `ai.agent_manage`, both served by the **service
> (clientCredentials) token**. Never call these from a browser — the admin
> token must not be exposed. Use them in Node, Next.js route handlers / server
> actions, or other trusted backends.

## Scope & quirks

- **Only `PRODUCT`** is supported today, so the `type` argument defaults to
  `"PRODUCT"` and is normally omitted.
- `reindex` triggers a **full** rebuild (no delta), runs **asynchronously**, and
  returns once the rebuild is *scheduled* — there is **no status endpoint** to
  poll, and it is **costly**, so call it sparingly.
- The set of embedded fields is configured in the **AI Service**, not here. This
  binding only *reads* the current field metadata and *triggers* a rebuild.
- `MetadataFilter.name` / `MetadataFilter.description` are **deprecated**
  upstream; rely on `key` and `type`.

## SDK

```ts
// Which fields are embedded for products?
const embedded = await client.ragIndexer.ragMetadata();
// → ["name", "description", "brand", ...]

// Which fields can be filtered on, and of what type?
const filters = await client.ragIndexer.filterMetadata();
for (const f of filters) console.log(f.key, f.type); // e.g. "price" "float"

// Trigger a full async rebuild (returns once scheduled; no progress to await)
await client.ragIndexer.reindex();
```

`MetadataFilter.type` is one of `string | integer | float | boolean | datetime |
date | time | dictionary | list | object`.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
