# AI Service — Full Facade Parity (Design)

**Date:** 2026-07-24
**Status:** approved (design)
**Package:** `@viu/emporix-sdk`
**Related:** builds on the api-sync PR #153 (branch `chore/emporix-api-sync`), which added
the 6 OAuth-config endpoints. Prior facade extension: `docs/superpowers/specs/2026-07-21-emporix-api-facade-extensions-design.md`.

## Goal

Bring the `AiService` facade to **full parity** with the vendored `ai-service`
OpenAPI spec. Today the facade wraps ~13 of 57 operations; the rest of the
agentic layer (tools, MCP servers, tokens, OAuth configs, jobs, templates,
attachments, export/import, logs, analytics, models, commerce-events) is
unimplemented. All 44 missing operations get typed, tested facade methods.

## Findings (gap analysis)

PR #153 changed only the `ai-service` spec (1 of 38; only its `sha256` moved).
**6 new operations, 0 removed, 0 newly deprecated.** The 6 new ones are the
OAuth-config CRUD. While mapping them, a full sweep of the spec showed the
facade covers only a curated subset.

**Already implemented (unchanged):** `generateText`, `complete`,
`listAgents`/`getAgent`/`upsertAgent`/`patchAgent`/`deleteAgent`/`searchAgents`,
`chat`/`chatAsync`/`chatStream`, `listConversations`/`searchConversations`.

**Missing (this work) — 44 operations:**

| Family | Ops | Path base |
|---|---|---|
| tools | 6 (CRUD) | `/agentic/tools` |
| mcp-servers | 6 (CRUD) | `/agentic/mcp-servers` |
| tokens | 6 (CRUD) | `/agentic/tokens` |
| oauths | 6 (CRUD) | `/agentic/oauths` |
| jobs | 4 | `/jobs` (**not** under `/agentic`) |
| templates | 3 | `/agentic/templates` |
| logs | 6 | `/agentic/logs/{requests,sessions}` |
| analytics | 2 | `/agentic/analytics` |
| models | 1 | `/agentic/models` |
| commerce-events | 1 | `/agentic/commerce-events` |
| attachments | 1 | `/agentic/{agentId}/attachments` |
| export/import | 2 | `/agentic/agents/{export,import}` |

## Scope

**In scope:** all 44 operations above, as typed facade methods with unit tests,
docs, and a changeset.

**Out of scope:** React bindings (the AI service has none and stays server-side
only); a storefront BFF/token-proxy; changing any existing method signature;
pagination-envelope (`PaginatedItems`) wrapping — the AI service's own
convention is raw arrays (`listAgents`), which we keep.

## Architecture

Purely **additive**. `AiService` keeps every existing flat method. New surface
hangs off it in three shapes, chosen per the resource's regularity.

### 1. Generic CRUD sub-resources

The four families `tools`, `mcp-servers`, `tokens`, `oauths` are identical in
shape (list / search / get / upsert / patch / delete). One generic helper
implements all four:

```ts
class AgenticCrudResource<Read, Write> {
  constructor(ctx: ClientContext, path: string) {}
  list(query?: ListQuery, auth?): Promise<Read[]>            // GET   {path}
  search(query: SearchQuery, auth?): Promise<Read[]>          // POST  {path}/search
  get(id, opts?: GetOptions, auth?): Promise<Read>            // GET   {path}/{id}
  upsert(id, body: Write, opts?: MutateOptions, auth?): Promise<Created | undefined> // PUT {path}/{id}
  patch(id, ops: AgenticPatchOp[], auth?): Promise<void>      // PATCH {path}/{id}
  delete(id, opts?: MutateOptions, auth?): Promise<void>      // DELETE {path}/{id}
}
```

Exposed as lazily-instantiated getters on `AiService`:
`client.ai.tools`, `client.ai.mcpServers`, `client.ai.tokens`, `client.ai.oauths`.

### 2. Bespoke resource groups

Small purpose-built classes for the asymmetric families:

- **`client.ai.jobs`** (`JobsResource`) — `list · search · get · delete`.
  Base path is `/ai-service/{tenant}/jobs` (**not** `/agentic`).
- **`client.ai.templates`** (`TemplatesResource`) — `list · search · clone`.
  `clone(templateId, body)` → `POST /agentic/templates/{templateId}/agents`,
  returns the created agent's id (`IdResponse`, HTTP 201).
- **`client.ai.logs`** (`LogsResource`) — `listRequests · getRequest ·
  searchRequests · listSessions · getSession · searchSessions`.
- **`client.ai.analytics`** (`AnalyticsResource`) — `get(opts?) · executions(query)`.
  `executions` **requires** `agentIds` (comma-separated string, ≤100) plus an
  optional `granularity` (`QUARTER | MONTH | WEEK`).

### 3. Standalone methods on `AiService`

Single/irregular operations stay flat:

- `listModels(auth?): Promise<ProviderModels[]>` — `GET /agentic/models`
- `listCommerceEvents(auth?): Promise<CommerceEvents>` — `GET /agentic/commerce-events` (single object)
- `uploadAttachment(agentId, attachment: Blob | File, opts?: AttachmentOptions, auth?): Promise<Attachment>`
  — `POST /agentic/{agentId}/attachments`, **multipart** (FormData field
  `attachment`), optional `session-id` header via `opts.sessionId`. HTTP 201.
- `exportAgents(body: AgentsExportRequest, auth?): Promise<AgentsExport>` — `POST /agentic/agents/export`
- `importAgents(body: AgentsImportRequest, auth?): Promise<AgentsImport>` — `POST /agentic/agents/import`

## Type aliases (`ai-types.ts`)

All aliased from `generated/ai-service`. Read = response shape, Input = upsert body.

| Alias | Generated source |
|---|---|
| `Tool` | `NativeToolsResponse[number]` (union of `*NativeToolResponse`) |
| `ToolInput` | `ToolUpsertBody` |
| `McpServer` | `McpServerResponse` |
| `McpServerInput` | `McpServerUpsertBody` (= `McpServerRequest`) |
| `Token` | `TokenResponse` |
| `TokenInput` | `TokenUpsertBody` (= `TokenRequest`) |
| `OAuthConfig` | `OAuthResponse` |
| `OAuthInput` | `OauthUpsertBody` (= `OAuthRequest`) |
| `AgenticPatchOp` | `PatchRequest[number]` — UPPERCASE `ADD \| REMOVE \| REPLACE` (shared with `AgentPatchOp`) |
| `Job` | `Job` |
| `AgentTemplate` | `AgentTemplateResponse` |
| `AgentFromTemplate` | `AgentFromTemplateRequest` (clone body) |
| `AgentRequestLog` | `AgentRequestResponse` |
| `AgentSessionLog` | `AgentSessionResponse` |
| `AgentAnalytics` | `AgentAnalyticsResponse` |
| `AgentExecutions` | `ExecutionsResponse` |
| `ProviderModels` | `ProviderModelsResponse` |
| `CommerceEvents` | `CommerceEventsResponse` |
| `Attachment` | `AttachmentResponse` |
| `AgentsExport` / `AgentsExportRequest` | `ExportResponse` / `ExportRequest` (`{ agentIds }`) |
| `AgentsImport` / `AgentsImportRequest` | `ImportResponse` / `ImportRequest` (= `DataWithChecksum`) |
| `Created` | `IdResponse` (`{ id? }`) |

**Shared option interfaces** (hand-written, permissive where the enum varies per family):

```ts
interface ListQuery   { q?: string; pageSize?: number; pageNumber?: number; sort?: string; fields?: string; expand?: string }
interface GetOptions  { fields?: string; expand?: string }
interface MutateOptions { force?: boolean }
interface SearchQuery { q?: string }            // every /search body is { q? }
interface AttachmentOptions { sessionId?: string }
interface AnalyticsQuery { agentId?: string }
interface ExecutionsQuery { agentIds: string; granularity?: "QUARTER" | "MONTH" | "WEEK" }
```

## Conventions

- **Return shapes:** `list`/`search` → raw arrays (mirrors `listAgents`);
  `get` → single Read; `upsert` (PUT) → `Created | undefined` (201 yields
  `{ id }`, 204 update yields `undefined`); `patch`/`delete` → `void` (204).
- **Query params:** `pageSize`/`pageNumber` accepted as `number`, passed through
  the http layer's `query` map (it stringifies). `force` sent as `"true"` only
  when set (matches `deleteAgent`).
- **Auth:** every method defaults to `SERVICE` (backend clientCredentials
  token). Server-side only — same caveat block as the rest of `AiService`.
  Read ops need `ai.agent_read`, mutations `ai.agent_manage`; this doesn't
  change the facade (all use the service token).
- **Patch is NOT RFC-6902:** ops use the upstream UPPERCASE enum, sent verbatim,
  exactly like the existing `patchAgent`.

## File layout

- `packages/sdk/src/services/ai.ts` — coordinator: existing methods + new getters
  (`tools`/`mcpServers`/`tokens`/`oauths`/`jobs`/`templates`/`logs`/`analytics`)
  + standalone methods.
- `packages/sdk/src/services/ai-resources.ts` *(new)* — `AgenticCrudResource`
  generic + `JobsResource` + `TemplatesResource` + `LogsResource` +
  `AnalyticsResource`. (May split further if it outgrows ~300 lines.)
- `packages/sdk/src/services/ai-types.ts` — all aliases + option interfaces.

Public re-exports: the new read/write/option types are re-exported from `ai.ts`
(same pattern as the existing block) so consumers import from the service.

## Testing

TDD, Vitest + MSW, mirroring `tests/services/ai.test.ts`. One file per family:

- `ai-tools.test.ts`, `ai-mcp-servers.test.ts`, `ai-tokens.test.ts`,
  `ai-oauths.test.ts` — CRUD happy paths; `ai-oauths` additionally covers the
  generic helper's edge cases: upsert **201 `{id}`** vs **204 `undefined`**,
  `?force=true` on upsert + delete, `expand`/paging query forwarding, UPPERCASE
  patch body sent verbatim.
- `ai-jobs.test.ts` — asserts the `/jobs` (non-agentic) path.
- `ai-templates.test.ts` — clone posts to `/templates/{id}/agents`, returns id.
- `ai-logs.test.ts`, `ai-analytics.test.ts` — path + query forwarding
  (`executions` requires `agentIds`).
- `ai-misc.test.ts` — models, commerce-events, attachment (asserts a FormData
  body + `session-id` header), export, import.

## Release & docs

- `docs/ai.md` — new sections for each family with usage snippets.
- `docs/emporix-upstream-changelog.md` — a `## 2026-07-24` entry noting full
  ai-service parity.
- Changeset: `@viu/emporix-sdk` **minor** (additive surface).
- Branch `feat/ai-service-parity` off `chore/emporix-api-sync`. PR target: the
  sync must land first; then retarget to `main` (as done for PR #148 → #150).

## Risks / known quirks

- **Tool list nesting:** the generated `GetAiListToolsResponse` is
  `Array<NativeToolsResponse>` where `NativeToolsResponse` is itself an array —
  an upstream schema quirk (list items point at the array schema, not the item
  schema). The facade types `tools.list()` as `Tool[]` (flat), matching the
  realistic wire shape and the single-item `get`. Flagged for runtime
  confirmation against the live tenant; if the API truly nests, revisit.
- **`upsert` 201/204 duality:** PUT returns `IdResponse` on create and 204 on
  update. `http.request` resolves 204 to `undefined`, so the `Created |
  undefined` return is honest; documented so callers null-check before reading
  `.id`.
- No live-tenant verification in this environment; correctness rests on the
  generated types + MSW. E2E against `viu` is out of scope here.
