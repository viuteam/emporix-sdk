# Emporix API Facade Extensions (Sync 2026-07)

**Status:** approved design — pending implementation plan
**Branch:** `feat/api-facade-extensions` (off `chore/emporix-api-sync`)
**Date:** 2026-07-21

## Context

The daily `api-sync` workflow re-vendored 13 upstream Emporix specs and
regenerated their types (branch `chore/emporix-api-sync`, commit `49de856`).
The sync updates **generated types only** — the hand-written service facades in
`packages/sdk/src/services/` are not touched. This spec covers the facade work
needed to expose the newly-available endpoints and to flag endpoints that
upstream marked deprecated.

### What actually changed (operation-level diff `main..chore/emporix-api-sync`)

- **5 new endpoints**, **0 removed**, **0 newly-deprecated**.
- 11 endpoints carry `deprecated: true`, but all were already deprecated in
  `main` — only 2 of them are wrapped by a facade method.

| # | New endpoint | operationId | Facade target |
|---|---|---|---|
| 1 | `POST /category/{tenant}/category-trees/{rootCategoryId}/rebuild` | `POST-category-tree-rebuild-category-tree` | `category.ts` |
| 2 | `PATCH /schema/{tenant}/custom-entities/{type}/instances/bulk` | `PATCH-schema-bulk-patch-custom-instances` | `schema.ts` |
| 3 | `GET /ai-service/{tenant}/agentic/conversations` | `GET-ai-list-conversations` | `ai.ts` |
| 4 | `POST /ai-service/{tenant}/agentic/conversations/search` | `POST-ai-search-conversations` | `ai.ts` |
| 5 | `POST /ai-service/{tenant}/agentic/chat-stream` | `POST-ai-agents-chat-stream` | `ai.ts` (SSE) |

Deprecated endpoints wrapped by a facade:

| Endpoint | operationId | Facade method | Action |
|---|---|---|---|
| `POST /indexing/{tenant}/reindex` | `POST-indexing-reindex` | `indexing.reindex()` | `@deprecated` → `createReindexJob` |
| `POST /ai-rag-indexer/{tenant}/{type}/reindex` | `GET-ai-rag-indexer-reindex` | `aiRagIndexer.reindex()` | `@deprecated` (verify replacement) |

Not actionable: `category.tree()` already targets the non-deprecated
`/category-trees` endpoint; the 8 deprecated `iam` endpoints have no facade.

## Goals / Non-goals

**Goals**
- Expose the 5 new endpoints through typed facade methods.
- Add first-class Server-Sent Events (SSE) streaming to the HTTP core, since
  `chat-stream` returns `text/event-stream`.
- Mark the 2 deprecated facade methods with `@deprecated` JSDoc + replacement.

**Non-goals**
- No changes to the vendored specs or generated types (owned by the sync PR).
- No IAM facade (the 8 deprecated `iam` endpoints stay unexposed).
- No breaking removals — deprecations are JSDoc-only this cycle.

## Design

### Component 1 — SSE streaming in the HTTP core

Two new units, kept separate so the parser is testable without the network.

**`core/sse.ts` — pure SSE frame parser.**
- `parseSseStream(chunks: AsyncIterable<string>): AsyncIterable<SseEvent>`
- `SseEvent = { event?: string; data: string; id?: string }`
- Buffers across chunk boundaries, splits frames on a blank line (`\n\n`),
  concatenates multi-line `data:` fields per the SSE spec, ignores comment
  lines (`:` prefix). Pure and synchronous per frame — no I/O.

**`http.requestStream(o: RequestOptions): AsyncIterable<SseEvent>` in `core/http.ts`.**
- Reuses token resolution + reauth-on-401 from `request`.
- Sets `Accept: text/event-stream`; reads `res.body` via a reader + `TextDecoder`
  and feeds `parseSseStream`.
- **Timeout semantics differ from `request`:** the overall read-budget timer is
  NOT applied (streams are long-lived). Only `connectMs` bounds time-to-headers;
  the consumer aborting the iterator (or an error) aborts the fetch via the
  existing `AbortController`.
- Non-2xx / auth failures map through `errors.ts` exactly as `request` does,
  before the stream begins.

### Component 2 — `ai.ts` agentic methods

- `async *chatStream(input: ChatRequest, opts?: { sessionId?: string }, auth: AuthContext = SERVICE): AsyncIterable<ChatStreamChunk>`
  - POST `agentic/chat-stream`; optional `session-id` header from `opts.sessionId`.
  - Yields each SSE `data` parsed as the generated chunk type (`ChatStreamChunk`,
    from the ai-service generated types). If upstream types the payload only as
    `string`, yield the raw `data` string and document it.
- `async listConversations(auth: AuthContext = SERVICE): Promise<Conversation[]>` → GET `agentic/conversations`.
- `async searchConversations(query: ConversationSearchQuery, auth: AuthContext = SERVICE): Promise<Conversation[]>` → POST `agentic/conversations/search`.

Follows the existing `ai.ts` patterns (`chat`, `chatAsync`, `searchAgents`):
`SERVICE` auth default, generated request/response types.

### Component 3 — `category.ts`

- `async rebuildTree(rootCategoryId: string, auth: AuthContext = SERVICE): Promise<void>`
  → POST `/category/{tenant}/category-trees/{rootCategoryId}/rebuild`.
- Auth default `SERVICE` (tree rebuild is an admin operation, unlike the
  `ANON` read methods) — confirm against the spec's security scopes at impl.

### Component 4 — `schema.ts`

- `async bulkPatchInstances(type: string, items: BulkPatchInstanceItem[], auth: AuthContext = SERVICE): Promise<BulkResponse>`
  → PATCH `custom-entities/{type}/instances/bulk`, using the existing
  `instancesBase(type)` helper.
- `BulkPatchInstanceItem = { id: string; data: PatchOperation[] }` (generated
  `BulkPatchCustomInstanceRequest`).
- Returns `BulkResponse` — the 207 per-item result array (`{ index, code,
  status, message?, details? }`). Document that a 207 is a success envelope,
  not an error; per-item status lives in the array.

### Component 5 — Deprecations (JSDoc only)

- `indexing.reindex()`: `@deprecated Use {@link createReindexJob} instead ...`
- `aiRagIndexer.reindex()`: `@deprecated` — verify the intended replacement from
  the upstream spec description during implementation; if none exists, the tag
  documents upstream's deprecation without a redirect.

## Types

All request/response shapes come from the generated schemas under
`src/generated/**` (repo rule: facades type inputs with generated schemas too,
not just outputs). No hand-authored duplicate types. Service `*-types.ts` files
get the new re-exports (e.g. `Conversation`, `ChatStreamChunk`,
`BulkPatchInstanceItem`) following the existing per-service pattern.

## Testing

- **SSE parser** (`core/sse.ts`): pure unit tests — single/multiple events,
  multi-line `data`, comment lines, and frames split across chunk boundaries.
- **`http.requestStream`**: MSW handler returning a `text/event-stream` body;
  assert events are yielded in order and the stream terminates; assert a
  pre-stream 401 maps to the auth error path.
- **Facade methods**: Vitest + MSW per method — happy path + auth-mode
  resolution, mirroring existing service tests. `chatStream` consumed via
  `for await`.

## Release & docs

- One `minor` changeset for `@viu/emporix-sdk` (additive surface). Deprecations
  are non-breaking (JSDoc), so no major bump.
- Short SSE/streaming usage note in `docs/` (new endpoints + `chatStream`
  consumption example).

## Sequencing

Merge the sync PR (`chore/emporix-api-sync`) first, then this `feat` PR. Both
touch the SDK; keeping generated-type churn in the sync PR and hand-written
facades here keeps each diff reviewable.
