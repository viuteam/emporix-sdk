# AI RAG Indexer Binding — Design

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Package:** `@viu/emporix-sdk` (core only)
- **Branch:** `feat/ai-rag-indexer`

## 1. Context & motivation

The SDK exposes one service binding per Emporix Commerce Engine service. The
**AI RAG Indexer** (`/ai-rag-indexer/{tenant}/{type}/…`) is not yet bound. It
backs Emporix's AI/RAG features by maintaining a vector index of tenant data.
For the storefront/back-office consumer it offers exactly two read endpoints —
to discover which fields are embedded and which are filterable — plus one
write endpoint that triggers a full asynchronous re-index.

This design adds a single, small, **read + trigger-only core service**, consumed
**server-side only**. No React bindings. It follows the established
"configuration service" pattern (codegen → service → facade → client wiring →
Vitest+MSW → docs → changeset) exactly.

### Upstream API summary (verified against the live OpenAPI)

- **Spec URL (HTTP 200):**
  `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/artificial-intelligence/ai-rag-indexer/api-reference/api.yml`
  → fetch-specs key `"ai-rag-indexer"`.
- **Auth:** OAuth2 `clientCredentials` only. Scopes:
  - `ai.agent_read` — both GETs
  - `ai.agent_manage` — `reindex`
  This is a **backend/service token**, never to be exposed in a browser.
- **Base path:** `/ai-rag-indexer/{tenant}/{type}` where `{type}` is currently
  **only `PRODUCT`** (the API models it as a path enum with one member today).
- **Endpoints (only 3):**
  - `GET /{type}/rag-metadata` → `string[]` — the indexable embedding field names
    for the type. (`ai.agent_read`)
  - `GET /{type}/filter-metadata` → `MetadataFilter[]` — the filterable fields.
    (`ai.agent_read`)
  - `POST /{type}/reindex` → **204 No Content**, **no request body**. Schedules a
    full asynchronous index rebuild. (`ai.agent_manage`)
- **`MetadataFilter` shape:**
  - `key: string` (required)
  - `type: "string" | "integer" | "float" | "boolean" | "datetime" | "date" | "time" | "dictionary" | "list" | "object"` (required)
  - `name?: string` — **deprecated** (kept for wire compatibility)
  - `description?: string` — **deprecated**

### Quirks (carried into docs + JSDoc)

- **Full rebuild only** — no delta/incremental indexing.
- **`reindex` is asynchronous**: returns `204` once the rebuild is *scheduled*,
  not when it completes. There is **no status/progress endpoint** — callers
  cannot poll. It is also **costly**; call sparingly.
- **`PRODUCT` is the only type today.** Methods take `type` as a parameter that
  **defaults to `"PRODUCT"`** so callers normally omit it, while the surface is
  ready for future types without a breaking change.
- `MetadataFilter.name` / `MetadataFilter.description` are deprecated; the SDK
  surfaces them (typed `optional`) but documents that they should not be relied on.
- **Embedding-field *configuration* lives in the AI Service, not here.** This
  binding is strictly **read (discover) + trigger (rebuild)**; it cannot change
  which fields are embedded.

## 2. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | Bind **all 3** endpoints (`rag-metadata`, `filter-metadata`, `reindex`) — nothing more (no status polling, it does not exist) |
| D2 | React bindings | **None** — core SDK only, server-side consumption |
| D3 | API shape | **One service**, `client.ragIndexer` (single resource group) |
| D4 | `type` handling | A **parameter defaulting to `"PRODUCT"`**, typed as a union (`RagType`) seeded from the generated enum, so callers omit it today and future types are non-breaking |
| D5 | `reindex` return | `Promise<void>` (204, no body) — mirrors `delete` in the configuration service |
| D6 | Types source | Codegen via the existing `@hey-api/openapi-ts` pipeline + thin public aliases (`MetadataFilter`, `RagType`) |
| D7 | Default auth | `{ kind: "service" }` (the `"backend"` credential set), overridable per call — identical to `media.ts` / `tenant-config.ts` |

## 3. Public API surface

```ts
// types (src/services/ai-rag-indexer-types.ts)
import type { MetadataFilter as GenMetadataFilter } from "../generated/ai-rag-indexer";

/** A filterable metadata field exposed by the RAG index. */
export type MetadataFilter = GenMetadataFilter;

/**
 * Indexable resource type. Only `"PRODUCT"` exists today; modelled as a string
 * union so future types extend it without a breaking change. Methods default
 * the `type` argument to `"PRODUCT"`.
 */
export type RagType = "PRODUCT";
```

```ts
// client.ragIndexer — RagIndexerService
ragMetadata(type?: RagType, auth?: AuthContext): Promise<string[]>
filterMetadata(type?: RagType, auth?: AuthContext): Promise<MetadataFilter[]>
reindex(type?: RagType, auth?: AuthContext): Promise<void>
```

### Behavioral notes

- `type` defaults to `"PRODUCT"` in every method; callers normally omit it.
- `type` is `encodeURIComponent`-escaped in the path (defensive; today's only
  value needs no escaping).
- `reindex` sends **no body** and resolves to `void` on `204`.
- No pagination — both GETs return a flat array.

## 4. Auth & data flow

- Module-level default: `const SERVICE: AuthContext = { kind: "service" }`
  (resolves to the `"backend"` credential set via `DefaultTokenProvider.getToken`).
  Every method takes a trailing optional `auth` defaulting to `SERVICE`.
- All requests go through `this.ctx.http.request<T>({ method, path, auth })`.
- Paths:
  - `GET /ai-rag-indexer/${tenant}/${enc(type)}/rag-metadata`
  - `GET /ai-rag-indexer/${tenant}/${enc(type)}/filter-metadata`
  - `POST /ai-rag-indexer/${tenant}/${enc(type)}/reindex`
- Server-only contract is documented; no anonymous/customer default, no React surface.

## 5. Codegen integration

1. `packages/sdk/scripts/fetch-specs.ts` — add to `SPECS`:
   ```ts
   "ai-rag-indexer": `${BASE}/artificial-intelligence/ai-rag-indexer/api-reference/api.yml`,
   ```
   (URL verified live → HTTP 200.)
2. `pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate`
   → produces `src/generated/ai-rag-indexer/{index.ts,types.gen.ts}` (types only).
3. Public aliases in `src/services/ai-rag-indexer-types.ts` import the generated
   `MetadataFilter`. If hey-api emitted a different name (e.g. a `Filter`-style
   alias), alias accordingly — the thin layer absorbs the difference. `RagType`
   is hand-declared `"PRODUCT"` (the generated path enum is the source of truth
   to confirm the literal during implementation).

## 6. Wiring

- `src/core/logger.ts`: add `"ai-rag-indexer"` to the `ServiceName` union.
- `src/client.ts`:
  - import `RagIndexerService`
  - add `readonly ragIndexer: RagIndexerService`
  - construct with `mk("ai-rag-indexer")` (next to `this.availability = …`)
- `src/index.ts`: re-export the facade.
- `src/ai-rag-indexer.ts`: one-line `export * from "./services/ai-rag-indexer"`.

## 7. Error handling

Reuse the existing HTTP error mapping in `core/http` + `core/errors`:
- 404 → `EmporixNotFoundError` (e.g. an unknown `type`)
- 403 → existing auth/forbidden error (missing `ai.agent_*` scope)
No service-specific catch logic (unlike `availability`'s default-on-404 helper).

## 8. Testing (Vitest + MSW)

`tests/services/ai-rag-indexer.test.ts` (MSW harness from `tenant-config.test.ts`:
oauth `/oauth/token` → `svc-tok`, assert `Bearer svc-tok`):
- `ragMetadata()` GETs `…/PRODUCT/rag-metadata`, returns `string[]`, sends the
  service token (assert `Bearer svc-tok`).
- `filterMetadata()` GETs `…/PRODUCT/filter-metadata`, returns `MetadataFilter[]`.
- `reindex()` POSTs `…/PRODUCT/reindex` with **no body**, server replies `204`,
  resolves to `void`.
- default `type` is `"PRODUCT"` (assert the path) and an explicit `type` flows
  through to the path.
- Type-level: `MetadataFilter.type` is the field-type union; `RagType` is `"PRODUCT"`.

`tests/services/ai-rag-indexer-wiring.test.ts`: `new EmporixClient(...).ragIndexer`
is an instance of `RagIndexerService`.

## 9. Out of scope (YAGNI)

- React hooks / `@viu/emporix-sdk-react` surface.
- e2e (the service/admin token must not live in the vite-spa).
- Re-index **status / progress polling** — the API exposes no such endpoint.
- Embedding-field configuration (lives in the AI Service, not this binding).
- Delta / incremental indexing (the API only does full rebuilds).
- Caching of the metadata reads.

## 10. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `"ai-rag-indexer"` spec entry |
| `packages/sdk/specs/ai-rag-indexer.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/ai-rag-indexer/**` | generated (committed) |
| `packages/sdk/src/services/ai-rag-indexer-types.ts` | new — public types (`MetadataFilter`, `RagType`) |
| `packages/sdk/src/services/ai-rag-indexer.ts` | new — `RagIndexerService` |
| `packages/sdk/src/ai-rag-indexer.ts` | new — facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"ai-rag-indexer"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `ragIndexer` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/ai-rag-indexer.test.ts` | new MSW tests |
| `packages/sdk/tests/services/ai-rag-indexer-wiring.test.ts` | client wiring test |
| `docs/ai-rag-indexer.md` | new — usage doc |
| `CLAUDE.md` | add RagIndexer to the service list |
| `.changeset/ai-rag-indexer.md` | minor: new `ragIndexer` service |
