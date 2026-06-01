# AI Service Binding — Design

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Package:** `@viu/emporix-sdk` (core only)
- **Branch:** `feat/ai-service`

## 1. Context & motivation

The SDK exposes a service binding per Emporix Commerce Engine service. The
**AI Service** (`/ai-service/{tenant}/…`) is not yet bound. It provides
LLM-backed primitives — single-shot text generation, multi-turn chat
completions, and a configurable "agentic" layer (named agents you can CRUD and
then chat with synchronously or asynchronously).

This design adds a single new **core service**, consumed **server-side only**.
No React bindings.

> **Storefront note (out of scope):** the AI Service authenticates with an
> OAuth2 `clientCredentials` (admin/service) token. That token must never reach
> a browser. A storefront chat experience that wanted to use the
> `ai.agentexecution_manage_own` scope (per-user agent execution) would have to
> go through a **BFF / token-proxy** that holds the service credentials and
> brokers each `chat` call — it cannot be wired directly into
> `@viu/emporix-sdk-react`. That BFF and any React surface are explicitly **out
> of scope** for this binding; this is core SDK only.

### Upstream API summary (verified against the live OpenAPI)

- **Spec URL** (HTTP 200):
  `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/artificial-intelligence/ai-service/api-reference/api.yml`
  → `fetch-specs` key **`ai-service`**.
- **API version:** `0.0.1` — explicitly **unstable**; shapes may change. The
  thin public-types layer (D5) insulates callers from churn.
- **Base path:** `/ai-service/{tenant}`.
- **Auth:** OAuth2 `clientCredentials` only (service/admin token). Scopes:
  - `ai.text_manage` — `POST /texts`
  - `ai.completion_manage` — `POST /completions`
  - `ai.agent_read` — `GET /agentic/agents`, `GET /agentic/agents/{id}`
  - `ai.agent_manage` — `PUT`/`PATCH`/`DELETE /agentic/agents/{id}`,
    `POST /agentic/agents/search`
  - `ai.agentexecution_manage` or `ai.agentexecution_manage_own` —
    `POST /agentic/chat`, `POST /agentic/chat-async`

#### Endpoints in scope

| Verb + path | Body | Returns | Notes |
|---|---|---|---|
| `POST /texts` | `{ id?, prompt, maxTokens? }` | `{ id?, result }` | single-shot text gen; **has `maxTokens`** |
| `POST /completions` | `{ id?, messages: [{ role, content }] }` | `{ id?, result }` | chat completion; **no `maxTokens`**; `role` ∈ `USER \| SYSTEM \| ASSISTANT` |
| `GET /agentic/agents` | — | `Agent[]` | list |
| `GET /agentic/agents/{id}` | — | `Agent` | retrieve one |
| `PUT /agentic/agents/{id}` | `Agent` | `Agent` | upsert (create-or-replace by id) |
| `PATCH /agentic/agents/{id}` | `[{ op, path, value? }]` | `Agent` | **op array**, `op` ∈ `ADD \| REMOVE \| REPLACE` (UPPERCASE, **not** RFC-6902 lowercase) |
| `DELETE /agentic/agents/{id}` | — | `204` | accepts `?force=true` (required if the agent is referenced elsewhere) |
| `POST /agentic/agents/search` | query object | `Agent[]` | server-side search |
| `POST /agentic/chat` | `{ agentId, message }` | **`ChatResponse[]`** = `[{ agentId, agentType, sessionId, message }]` | synchronous; **returns an array** |
| `POST /agentic/chat-async` | `{ agentId, message }` | **`JobIdResponse[]`** = `[{ jobId }]`, HTTP **201** | fire-and-forget; **returns an array** |

#### Upstream quirks (must be honored in the binding)

- **Both chat endpoints return ARRAYS**, not single objects — `chat` →
  `ChatResponse[]`, `chatAsync` → `{ jobId }[]`. The SDK preserves the array.
- **No `model` field** anywhere — the model is server-fixed per tenant config.
  The SDK does not expose a model parameter.
- **`/texts` has `maxTokens`; `/completions` does not.** The two request shapes
  are deliberately different and are not unified.
- **PATCH uses an UPPERCASE op enum** (`ADD`/`REMOVE`/`REPLACE`), unlike a
  standard RFC-6902 JSON-Patch (`add`/`remove`/`replace`). The SDK types and
  passes the ops verbatim — no translation.
- **DELETE needs `?force=true`** when the agent is referenced; exposed as an
  options arg.

## 2. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | texts, completions, agents CRUD (list/get/upsert/patch/delete/search), chat, chat-async — see §9 for deferrals |
| D2 | React bindings | **None** — core SDK only, server-side consumption (BFF required for any browser chat; out of scope) |
| D3 | API shape | **One service**: `client.ai` (a single upstream service; agents/chat/texts are facets of it, unlike the two-group Configuration service) |
| D4 | Method name for DELETE | `deleteAgent` (verb-prefixed because the service hosts several resource families; mirrors the HTTP verb) |
| D5 | Types source | Codegen via existing `@hey-api/openapi-ts` pipeline + thin public aliases (insulates callers from the `0.0.1` churn) |
| D6 | Default auth | `{ kind: "service" }` (credential set `"backend"`), overridable per call — identical to `tenant-config.ts` / `media.ts` |
| D7 | Chat return shape | **Return the array verbatim** (`ChatResponse[]` / `JobIdResponse[]`) — do not unwrap to the first element; the upstream contract is an array and unwrapping would hide multi-response cases |

## 3. Public API surface

```ts
// types (src/services/ai-types.ts) — thin aliases over generated names.
// If hey-api emits different names, alias accordingly (verified in plan Task 1).
export type TextRequest = GenTextRequest;        // { id?, prompt, maxTokens? }
export type TextResponse = GenTextResponse;       // { id?, result }
export type CompletionMessage = GenMessage;       // { role: "USER"|"SYSTEM"|"ASSISTANT"; content: string }
export type CompletionRequest = GenCompletionRequest; // { id?, messages: CompletionMessage[] }
export type CompletionResponse = GenCompletionResponse; // { id?, result }
export type Agent = GenAgent;
export type AgentPatchOp = GenAgentPatchOp;        // { op: "ADD"|"REMOVE"|"REPLACE"; path: string; value?: unknown }
export type AgentSearchQuery = GenAgentSearchQuery;
export type ChatRequest = GenChatRequest;          // { agentId, message }
export type ChatResponse = GenChatResponse;        // { agentId, agentType, sessionId, message }
export type JobIdResponse = GenJobIdResponse;      // { jobId }
export interface DeleteAgentOptions { force?: boolean }
```

```ts
// client.ai — AiService (default auth: SERVICE for every method)
generateText(input: TextRequest, auth?: AuthContext): Promise<TextResponse>
complete(input: CompletionRequest, auth?: AuthContext): Promise<CompletionResponse>

listAgents(auth?: AuthContext): Promise<Agent[]>
getAgent(id: string, auth?: AuthContext): Promise<Agent>
upsertAgent(id: string, agent: Agent, auth?: AuthContext): Promise<Agent>
patchAgent(id: string, ops: AgentPatchOp[], auth?: AuthContext): Promise<Agent>
deleteAgent(id: string, auth?: AuthContext, opts?: DeleteAgentOptions): Promise<void>
searchAgents(query: AgentSearchQuery, auth?: AuthContext): Promise<Agent[]>

chat(input: ChatRequest, auth?: AuthContext): Promise<ChatResponse[]>
chatAsync(input: ChatRequest, auth?: AuthContext): Promise<JobIdResponse[]>
```

### Behavioral notes

- `generateText` / `complete` accept the generated request shape verbatim
  (caller supplies the exact wire body), mirroring `media.ts`'s
  "send the generated type" convention. No `model` parameter exists.
- `patchAgent` takes `AgentPatchOp[]` with the **uppercase** `op` enum and is
  passed as the request body unchanged. No RFC-6902 translation.
- `deleteAgent` serializes `opts.force` to `query: { force: true }` only when
  `true`; omitted otherwise.
- `chat` / `chatAsync` return the **array** exactly as the server sends it
  (D7). `chatAsync` succeeds on HTTP 201.
- `id` (agent id) is `encodeURIComponent`-escaped in paths.

## 4. Auth & data flow

- Module-level default: `const SERVICE: AuthContext = { kind: "service" }`
  (resolves to the `"backend"` credential set via `DefaultTokenProvider.getToken`).
  Every method takes a trailing optional `auth` defaulting to `SERVICE`.
- All requests go through `this.ctx.http.request<T>({ method, path, query, body, auth })`.
- Paths (all under `/ai-service/${tenant}`):
  - `/texts`, `/completions`
  - `/agentic/agents`, `/agentic/agents/${enc(id)}`, `/agentic/agents/search`
  - `/agentic/chat`, `/agentic/chat-async`
- Server-only contract is documented; no anonymous/customer default, no React
  surface. A browser chat would need a BFF (see §1) — out of scope.

## 5. Codegen integration

1. `packages/sdk/scripts/fetch-specs.ts` — add to `SPECS`:
   ```ts
   "ai-service": `${BASE}/artificial-intelligence/ai-service/api-reference/api.yml`,
   ```
   (URL verified live → HTTP 200.)
2. `pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate`
   → produces `src/generated/ai-service/{index.ts,types.gen.ts}` (types only).
3. Public aliases in `src/services/ai-types.ts` import the generated names and
   re-export under the stable public names in §3. If hey-api emitted different
   names, alias accordingly (the thin layer absorbs that). The exact generated
   names are a **verify-during-implementation** step in the plan.

## 6. Wiring

- `src/core/logger.ts`: add `"ai"` to the `ServiceName` union.
- `src/client.ts`:
  - import `AiService`
  - add `readonly ai: AiService`
  - construct with `mk("ai")`
- `src/index.ts`: re-export the public types and the service via the facade.
- `src/ai.ts`: one-line `export * from "./services/ai"`.

## 7. Error handling

Reuse the existing HTTP error mapping in `core/http` + `core/errors`:
- 404 → `EmporixNotFoundError` (propagates from `getAgent`/`patchAgent`/`deleteAgent`)
- 409 → existing conflict error (e.g. `deleteAgent` on a referenced agent without `force`)
- 400 → existing validation error
No service-specific catch logic.

## 8. Testing (Vitest + MSW)

`tests/services/ai.test.ts` (+ a small `ai-types.test.ts` type-level test and a
`ai-wiring.test.ts` client wiring test):
- MSW harness mirrors `tenant-config.test.ts`: stub `POST /oauth/token` → `svc-tok`;
  every assertion checks the `authorization` header is **`Bearer svc-tok`**.
- `generateText` POSTs `{ prompt, maxTokens }` and returns `{ result }`.
- `complete` POSTs `{ messages: [...] }` and returns `{ result }`.
- `listAgents` GETs the array; `getAgent` happy path; `getAgent` → 404 throws
  `EmporixNotFoundError`.
- `upsertAgent` PUTs the agent; `patchAgent` PATCHes the **uppercase** op array
  verbatim; `searchAgents` POSTs to `/agentic/agents/search`.
- `deleteAgent` → 204 resolves to `void`; with `{ force: true }` asserts
  `?force=true` query.
- `chat` returns the **array** `ChatResponse[]` (asserts length ≥ 1, not unwrapped).
- `chatAsync` returns `JobIdResponse[]` on HTTP **201**.
- `encodeURIComponent`-escapes the agent id in the path.
- Wiring test: `new EmporixClient(...).ai instanceof AiService`.

## 9. Out of scope (YAGNI / deferred)

- **Deferred AI endpoints:** templates, import/export, logs/sessions, tokens.
  These are listed here so the next iteration knows what remains; they are not
  bound now.
- React hooks / `@viu/emporix-sdk-react` surface.
- The **BFF / token-proxy** required for any browser chat using
  `ai.agentexecution_manage_own` (see §1) — out of scope; documented as a note.
- e2e (admin token must not live in the vite-spa).
- Polling helpers / job-status retrieval for `chatAsync` (would depend on the
  deferred logs/sessions endpoints).
- Any `model` selection (server-fixed).

## 10. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `ai-service` spec entry |
| `packages/sdk/specs/ai-service.yml` | fetched OpenAPI (committed) |
| `packages/sdk/src/generated/ai-service/**` | generated (committed) |
| `packages/sdk/src/services/ai-types.ts` | new — public type aliases |
| `packages/sdk/src/services/ai.ts` | new — `AiService` |
| `packages/sdk/src/ai.ts` | new — facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"ai"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `ai` via `mk("ai")` |
| `packages/sdk/src/index.ts` | re-export facade |
| `packages/sdk/tests/services/ai-types.test.ts` | new type-level tests |
| `packages/sdk/tests/services/ai.test.ts` | new MSW tests |
| `packages/sdk/tests/services/ai-wiring.test.ts` | new wiring test |
| `docs/ai.md` | new — usage doc (incl. the BFF note) |
| `CLAUDE.md` | add AI to the service list |
| `.changeset/*.md` | minor: new `client.ai` service |
