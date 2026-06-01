# AI Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **AI Service** as a single server-side core SDK service, `client.ai`, covering text generation, chat completions, agent CRUD (list/get/upsert/patch/delete/search), and synchronous + asynchronous agentic chat.

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module (`ai-types.ts`) re-exports stable public names over the generated ones (insulating callers from the `0.0.1` upstream churn). One service class `AiService` mirrors the upstream service, defaulting to the service (clientCredentials) token like `tenant-config`/`media`. It is wired onto `EmporixClient` exactly like the other services.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-ai-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `ai-service` spec URL to the fetch list |
| `packages/sdk/specs/ai-service.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/ai-service/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/ai-types.ts` | public type aliases: `TextRequest`/`TextResponse`/`CompletionRequest`/`CompletionResponse`/`Agent`/`AgentPatchOp`/`AgentSearchQuery`/`ChatRequest`/`ChatResponse`/`JobIdResponse`/`DeleteAgentOptions` |
| `packages/sdk/src/services/ai.ts` | `AiService` (texts, completions, agents CRUD, chat, chat-async) |
| `packages/sdk/src/ai.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"ai"` to the `ServiceName` union |
| `packages/sdk/src/client.ts` | construct + expose `ai` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/ai-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/ai.test.ts` | MSW tests |
| `packages/sdk/tests/services/ai-wiring.test.ts` | client wiring test |
| `docs/ai.md` | usage doc (incl. BFF note) |
| `CLAUDE.md` | service-list update |
| `.changeset/ai-service.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

---

## Task 1: Generate AI Service types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/ai-service.yml`, `packages/sdk/src/generated/ai-service/index.ts`, `packages/sdk/src/generated/ai-service/types.gen.ts`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add this line to the `SPECS` object (after the `configuration` entry):

```ts
  "ai-service": `${BASE}/artificial-intelligence/ai-service/api-reference/api.yml`,
```

(URL verified live → HTTP 200.)

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched ai-service (...bytes)` and the generate step writes `src/generated/ai-service/`.

- [ ] **Step 3: Verify the generated type names**

The spec (D5) uses **placeholder** generated names (`GenTextRequest`, etc.). hey-api derives names from the OpenAPI `components.schemas` keys, which will differ. Discover the real names:

```bash
grep -nE "^export type " packages/sdk/src/generated/ai-service/types.gen.ts
```
Expected: a list of exported type names. Identify the one type per role and record the exact name in a scratch note for Task 2:
- text request (has `prompt`, optional `maxTokens`) → e.g. `TextGenerationRequest` / `GenerateTextRequest`
- text response (has `result`) → e.g. `TextGenerationResponse`
- completion request (has `messages`) and completion response (has `result`)
- agent → e.g. `Agent` / `AgenticAgent`
- agent PATCH op (has `op` enum `ADD`/`REMOVE`/`REPLACE`, `path`) → e.g. `PatchOperation`
- agent search query (the request body of `POST /agentic/agents/search`)
- chat request (`agentId`,`message`), chat response (`agentId`,`agentType`,`sessionId`,`message`), job-id response (`jobId`)

If a request/response schema is **inlined** (no named component, so no exported type), define the public type structurally in Task 2 instead of aliasing (note which ones in the scratch note). Confirm the `op` enum casing while here:
```bash
grep -niE "ADD|REMOVE|REPLACE" packages/sdk/src/generated/ai-service/types.gen.ts
```
Expected: UPPERCASE `ADD`/`REMOVE`/`REPLACE` (confirms the §1 quirk). If lowercase, update Task 2's `AgentPatchOp` and the test accordingly.

- [ ] **Step 4: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` also touched other `specs/*.yml` or `src/generated/*` files (upstream drift unrelated to this feature), restore them so this PR stays scoped:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-run Step 2 and immediately stage just the `ai-service` paths in Step 5. (If `git status` showed only the new `ai-service` files, skip this step.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/ai-service.yml packages/sdk/src/generated/ai-service
git commit -m "feat(sdk): generate ai service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/ai-types.ts`
- Test: `packages/sdk/tests/services/ai-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/ai-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  TextRequest,
  TextResponse,
  CompletionRequest,
  CompletionResponse,
  Agent,
  AgentPatchOp,
  ChatRequest,
  ChatResponse,
  JobIdResponse,
  DeleteAgentOptions,
} from "../../src/services/ai-types";

describe("ai types", () => {
  it("TextRequest carries prompt and optional maxTokens", () => {
    const r: TextRequest = { prompt: "hi" };
    expectTypeOf(r.prompt).toEqualTypeOf<string>();
    // maxTokens is optional; both forms compile.
    const r2: TextRequest = { prompt: "hi", maxTokens: 256 };
    expectTypeOf(r2.maxTokens).toEqualTypeOf<number | undefined>();
  });

  it("TextResponse / CompletionResponse expose result", () => {
    const tr: TextResponse = { result: "ok" };
    const cr: CompletionResponse = { result: "ok" };
    expectTypeOf(tr.result).toEqualTypeOf<string>();
    expectTypeOf(cr.result).toEqualTypeOf<string>();
  });

  it("CompletionRequest holds a messages array", () => {
    const c: CompletionRequest = { messages: [{ role: "USER", content: "hi" }] };
    expectTypeOf(c.messages).toBeArray();
  });

  it("AgentPatchOp uses the UPPERCASE op enum", () => {
    const op: AgentPatchOp = { op: "REPLACE", path: "/name", value: "x" };
    expectTypeOf(op.op).toEqualTypeOf<"ADD" | "REMOVE" | "REPLACE">();
  });

  it("ChatRequest / ChatResponse / JobIdResponse shapes", () => {
    const req: ChatRequest = { agentId: "a", message: "hi" };
    const res: ChatResponse = { agentId: "a", agentType: "t", sessionId: "s", message: "hi" };
    const job: JobIdResponse = { jobId: "j" };
    expectTypeOf(req.agentId).toEqualTypeOf<string>();
    expectTypeOf(res.sessionId).toEqualTypeOf<string>();
    expectTypeOf(job.jobId).toEqualTypeOf<string>();
  });

  it("Agent and DeleteAgentOptions are usable", () => {
    expectTypeOf<Agent>().not.toBeNever();
    const o: DeleteAgentOptions = { force: true };
    expectTypeOf(o.force).toEqualTypeOf<boolean | undefined>();
  });
});
```

> **If Task 1 reported a different `op` enum casing or inlined schemas:** adjust the `expectTypeOf` lines for `AgentPatchOp.op` and any structurally-defined types so they match the real generated shape. The test asserts the *public contract*, not the generated names.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-types.test.ts`
Expected: FAIL — cannot find module `../../src/services/ai-types`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/ai-types.ts`. **Replace each `Gen*` import name with the actual generated name recorded in Task 1, Step 3.** For any schema that was inlined (no named export), keep the structural `interface`/`type` shown below instead of the alias.

```ts
import type {
  // Replace these with the real generated names from Task 1, Step 3.
  TextGenerationRequest as GenTextRequest,
  TextGenerationResponse as GenTextResponse,
  CompletionRequest as GenCompletionRequest,
  CompletionResponse as GenCompletionResponse,
  Agent as GenAgent,
  PatchOperation as GenAgentPatchOp,
  AgentSearchRequest as GenAgentSearchQuery,
  ChatRequest as GenChatRequest,
  ChatResponse as GenChatResponse,
  JobIdResponse as GenJobIdResponse,
} from "../generated/ai-service";

/** Single-shot text generation request (`POST /texts`). Has `maxTokens`. */
export type TextRequest = GenTextRequest;
/** Text generation response — `{ id?, result }`. */
export type TextResponse = GenTextResponse;

/** One message in a completion request. `role` ∈ `USER | SYSTEM | ASSISTANT`. */
export type CompletionMessage = GenCompletionRequest["messages"][number];
/** Chat completion request (`POST /completions`). No `maxTokens` (server-fixed model). */
export type CompletionRequest = GenCompletionRequest;
/** Chat completion response — `{ id?, result }`. */
export type CompletionResponse = GenCompletionResponse;

/** An agentic agent definition. */
export type Agent = GenAgent;
/**
 * One PATCH operation for `patchAgent`. `op` is the upstream UPPERCASE enum
 * (`ADD | REMOVE | REPLACE`) — NOT RFC-6902 lowercase. Passed verbatim.
 */
export type AgentPatchOp = GenAgentPatchOp;
/** Request body for `POST /agentic/agents/search`. */
export type AgentSearchQuery = GenAgentSearchQuery;

/** Request body for `chat` / `chatAsync` — `{ agentId, message }`. */
export type ChatRequest = GenChatRequest;
/** One synchronous chat result — `{ agentId, agentType, sessionId, message }`. */
export type ChatResponse = GenChatResponse;
/** One async job acknowledgement — `{ jobId }`. */
export type JobIdResponse = GenJobIdResponse;

/** Options for {@link AiService.deleteAgent}. */
export interface DeleteAgentOptions {
  /** Force deletion even if the agent is referenced elsewhere (`?force=true`). */
  force?: boolean;
}
```

If the generated names do not map cleanly (e.g. a request schema is inlined, or
`maxTokens`/`messages`/`op` are not where expected), fall back to defining that
single type structurally, e.g.:

```ts
export interface TextRequest { id?: string; prompt: string; maxTokens?: number }
export interface TextResponse { id?: string; result: string }
export interface CompletionMessage { role: "USER" | "SYSTEM" | "ASSISTANT"; content: string }
export interface CompletionRequest { id?: string; messages: CompletionMessage[] }
export interface CompletionResponse { id?: string; result: string }
export interface AgentPatchOp { op: "ADD" | "REMOVE" | "REPLACE"; path: string; value?: unknown }
export interface ChatRequest { agentId: string; message: string }
export interface ChatResponse { agentId: string; agentType: string; sessionId: string; message: string }
export interface JobIdResponse { jobId: string }
```
Keep `Agent` / `AgentSearchQuery` as generated aliases even if others fall back.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai-types.ts packages/sdk/tests/services/ai-types.test.ts
git commit -m "feat(sdk): add ai service public types"
```

---

## Task 3: AiService

**Files:**
- Create: `packages/sdk/src/services/ai.ts`, `packages/sdk/src/ai.ts`
- Test: `packages/sdk/tests/services/ai.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/ai.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { AiService } from "../../src/services/ai";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "ai" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new AiService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/ai-service/acme";

describe("AiService", () => {
  it("generateText POSTs the prompt with a service token and returns the result", async () => {
    let seenAuth: string | null = null;
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/texts`, async ({ request }) => {
        seenAuth = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json({ id: "t1", result: "hello world" });
      }),
    );
    const res = await svc().generateText({ prompt: "say hi", maxTokens: 16 });
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(body).toEqual({ prompt: "say hi", maxTokens: 16 });
    expect(res.result).toBe("hello world");
  });

  it("complete POSTs the messages array and returns the result", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/completions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "c1", result: "answer" });
      }),
    );
    const res = await svc().complete({ messages: [{ role: "USER", content: "hi" }] });
    expect(body).toEqual({ messages: [{ role: "USER", content: "hi" }] });
    expect(res.result).toBe("answer");
  });

  it("listAgents GETs the agent array", async () => {
    server.use(
      http.get(`${BASE}/agentic/agents`, () =>
        HttpResponse.json([{ id: "a1", name: "Support" }, { id: "a2", name: "Sales" }]),
      ),
    );
    const agents = await svc().listAgents();
    expect(agents.map((a) => (a as { id: string }).id)).toEqual(["a1", "a2"]);
  });

  it("getAgent fetches one agent by id", async () => {
    server.use(
      http.get(`${BASE}/agentic/agents/a1`, () => HttpResponse.json({ id: "a1", name: "Support" })),
    );
    const a = await svc().getAgent("a1");
    expect((a as { id: string }).id).toBe("a1");
  });

  it("getAgent throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/agentic/agents/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getAgent("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("upsertAgent PUTs the agent and returns it", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/agentic/agents/a1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a1", name: "Support" });
      }),
    );
    const a = await svc().upsertAgent("a1", { id: "a1", name: "Support" } as never);
    expect(body).toEqual({ id: "a1", name: "Support" });
    expect((a as { name: string }).name).toBe("Support");
  });

  it("patchAgent PATCHes the UPPERCASE op array verbatim", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/agentic/agents/a1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a1", name: "Renamed" });
      }),
    );
    const a = await svc().patchAgent("a1", [{ op: "REPLACE", path: "/name", value: "Renamed" }]);
    expect(body).toEqual([{ op: "REPLACE", path: "/name", value: "Renamed" }]);
    expect((a as { name: string }).name).toBe("Renamed");
  });

  it("searchAgents POSTs the query to /agentic/agents/search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/agents/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "a1", name: "Support" }]);
      }),
    );
    const found = await svc().searchAgents({ name: "Sup" } as never);
    expect(body).toEqual({ name: "Sup" });
    expect(found).toHaveLength(1);
  });

  it("deleteAgent DELETEs and resolves to void (no force query by default)", async () => {
    let search = "x";
    server.use(
      http.delete(`${BASE}/agentic/agents/a1`, ({ request }) => {
        search = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteAgent("a1")).resolves.toBeUndefined();
    expect(search).toBe("");
  });

  it("deleteAgent passes ?force=true when forced", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.delete(`${BASE}/agentic/agents/a1`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().deleteAgent("a1", undefined, { force: true });
    expect((q as URLSearchParams | null)?.get("force")).toBe("true");
  });

  it("chat returns the ChatResponse ARRAY (not unwrapped)", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/chat`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([
          { agentId: "a1", agentType: "support", sessionId: "s1", message: "hi there" },
        ]);
      }),
    );
    const out = await svc().chat({ agentId: "a1", message: "hi" });
    expect(body).toEqual({ agentId: "a1", message: "hi" });
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]?.sessionId).toBe("s1");
  });

  it("chatAsync returns the JobIdResponse ARRAY on HTTP 201", async () => {
    server.use(
      http.post(`${BASE}/agentic/chat-async`, () =>
        HttpResponse.json([{ jobId: "job-1" }], { status: 201 }),
      ),
    );
    const out = await svc().chatAsync({ agentId: "a1", message: "hi" });
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]?.jobId).toBe("job-1");
  });

  it("encodeURIComponent-escapes the agent id in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/ai-service/acme/agentic/agents/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "a/b" });
      }),
    );
    await svc().getAgent("a/b");
    expect(pathname).toBe("/ai-service/acme/agentic/agents/a%2Fb");
  });
});
```

> If Task 1 found inlined schemas and Task 2 fell back to structural types, the
> `as never` casts on `upsertAgent` / `searchAgents` inputs may be removable —
> drop them if the structural types accept the literals directly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai.test.ts`
Expected: FAIL — cannot find module `../../src/services/ai`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/ai.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  TextRequest,
  TextResponse,
  CompletionRequest,
  CompletionResponse,
  Agent,
  AgentPatchOp,
  AgentSearchQuery,
  ChatRequest,
  ChatResponse,
  JobIdResponse,
  DeleteAgentOptions,
} from "./ai-types";

export type {
  TextRequest,
  TextResponse,
  CompletionMessage,
  CompletionRequest,
  CompletionResponse,
  Agent,
  AgentPatchOp,
  AgentSearchQuery,
  ChatRequest,
  ChatResponse,
  JobIdResponse,
  DeleteAgentOptions,
} from "./ai-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix AI Service (`/ai-service/{tenant}/…`): text generation, chat
 * completions, and the agentic layer (agent CRUD + synchronous/asynchronous
 * chat). Every endpoint requires a backend-only `ai.*` scope and the
 * **service (clientCredentials) token** — default auth: service.
 *
 * Server-side use only; the service token must never reach a browser. A
 * storefront chat (scope `ai.agentexecution_manage_own`) would require a
 * BFF / token-proxy — out of scope for this SDK.
 *
 * The model is server-fixed per tenant; there is no `model` parameter.
 */
export class AiService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/ai-service/${this.ctx.tenant}`;
  }

  /** Generate text from a single prompt (`POST /texts`). Honors `maxTokens`. */
  async generateText(input: TextRequest, auth: AuthContext = SERVICE): Promise<TextResponse> {
    return this.ctx.http.request<TextResponse>({
      method: "POST",
      path: `${this.base()}/texts`,
      auth,
      body: input,
    });
  }

  /** Run a chat completion over a message list (`POST /completions`). No `maxTokens`. */
  async complete(
    input: CompletionRequest,
    auth: AuthContext = SERVICE,
  ): Promise<CompletionResponse> {
    return this.ctx.http.request<CompletionResponse>({
      method: "POST",
      path: `${this.base()}/completions`,
      auth,
      body: input,
    });
  }

  /** List all agentic agents. */
  async listAgents(auth: AuthContext = SERVICE): Promise<Agent[]> {
    return this.ctx.http.request<Agent[]>({
      method: "GET",
      path: `${this.base()}/agentic/agents`,
      auth,
    });
  }

  /** Retrieve one agent by id. */
  async getAgent(id: string, auth: AuthContext = SERVICE): Promise<Agent> {
    return this.ctx.http.request<Agent>({
      method: "GET",
      path: `${this.base()}/agentic/agents/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create-or-replace an agent by id (`PUT`). */
  async upsertAgent(id: string, agent: Agent, auth: AuthContext = SERVICE): Promise<Agent> {
    return this.ctx.http.request<Agent>({
      method: "PUT",
      path: `${this.base()}/agentic/agents/${encodeURIComponent(id)}`,
      auth,
      body: agent,
    });
  }

  /**
   * Patch an agent with an op array (`PATCH`). `ops` use the upstream
   * UPPERCASE enum (`ADD | REMOVE | REPLACE`) and are sent verbatim — this is
   * NOT RFC-6902 JSON-Patch.
   */
  async patchAgent(
    id: string,
    ops: AgentPatchOp[],
    auth: AuthContext = SERVICE,
  ): Promise<Agent> {
    return this.ctx.http.request<Agent>({
      method: "PATCH",
      path: `${this.base()}/agentic/agents/${encodeURIComponent(id)}`,
      auth,
      body: ops,
    });
  }

  /**
   * Delete an agent by id. Pass `{ force: true }` to delete an agent that is
   * still referenced elsewhere (`?force=true`).
   */
  async deleteAgent(
    id: string,
    auth: AuthContext = SERVICE,
    opts: DeleteAgentOptions = {},
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/agentic/agents/${encodeURIComponent(id)}`,
      auth,
      ...(opts.force ? { query: { force: true } } : {}),
    });
  }

  /** Server-side agent search (`POST /agentic/agents/search`). */
  async searchAgents(query: AgentSearchQuery, auth: AuthContext = SERVICE): Promise<Agent[]> {
    return this.ctx.http.request<Agent[]>({
      method: "POST",
      path: `${this.base()}/agentic/agents/search`,
      auth,
      body: query,
    });
  }

  /**
   * Synchronous agent chat (`POST /agentic/chat`). Returns the response
   * ARRAY verbatim (the upstream contract is an array, not a single object).
   */
  async chat(input: ChatRequest, auth: AuthContext = SERVICE): Promise<ChatResponse[]> {
    return this.ctx.http.request<ChatResponse[]>({
      method: "POST",
      path: `${this.base()}/agentic/chat`,
      auth,
      body: input,
    });
  }

  /**
   * Fire-and-forget agent chat (`POST /agentic/chat-async`, HTTP 201).
   * Returns the job-id ARRAY verbatim.
   */
  async chatAsync(input: ChatRequest, auth: AuthContext = SERVICE): Promise<JobIdResponse[]> {
    return this.ctx.http.request<JobIdResponse[]>({
      method: "POST",
      path: `${this.base()}/agentic/chat-async`,
      auth,
      body: input,
    });
  }
}
```

Create the facade `packages/sdk/src/ai.ts`:

```ts
export * from "./services/ai";
```

> **Note on `query: { force: true }`:** `RequestOptions.query` is typed
> `Record<string, string | number | undefined>`. `true` is a boolean, which is
> NOT assignable. Use `{ force: "true" }` (string) instead so it typechecks and
> serializes to `?force=true`. **Apply this in the code above:** change
> `{ query: { force: true } }` to `{ query: { force: "true" } }`. The test
> asserts the string `"true"`, so it stays green.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0. If typecheck flags `force: true`, you missed the string-coercion note above.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai.ts packages/sdk/src/ai.ts packages/sdk/tests/services/ai.test.ts
git commit -m "feat(sdk): add ai service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/ai-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/ai-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { AiService } from "../../src/services/ai";

describe("EmporixClient ai wiring", () => {
  it("exposes the ai service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.ai).toBeInstanceOf(AiService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-wiring.test.ts`
Expected: FAIL — `sdk.ai` is `undefined` (not an instance).

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"ai"` to the `ServiceName` union (insert before `| "http"`, after `| "configuration"`):

```ts
  | "configuration"
  | "ai"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

In `packages/sdk/src/client.ts`, add the import next to the other service imports (after the `ClientConfigService` import):

```ts
import { AiService } from "./services/ai";
```

Add the readonly field next to the other service fields (after `clientConfig`):

```ts
  readonly ai: AiService;
```

Construct it in the constructor next to the other `this.x = new XService(mk(...))` lines (after `this.clientConfig = ...`):

```ts
    this.ai = new AiService(mk("ai"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add this line next to the other `export * from "./<facade>"` lines (after `export * from "./client-config";`):

```ts
export * from "./ai";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/ai-wiring.test.ts
git commit -m "feat(sdk): expose ai service on the client"
```

---

## Task 5: Documentation

**Files:**
- Create: `docs/ai.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/ai.md`:

````markdown
# AI Service

Bindings for the Emporix **AI Service** (`/ai-service/{tenant}/…`): text
generation, chat completions, and the agentic layer (agent CRUD + synchronous /
asynchronous chat).

> **Server-side only.** Every endpoint requires a backend `ai.*` scope, served
> by the **service (clientCredentials) token**. Never construct these calls from
> a browser — the admin token must not be exposed. Use them in Node, Next.js
> route handlers / server actions, or other trusted backends.
>
> **Storefront chat?** A browser chat using the per-user
> `ai.agentexecution_manage_own` scope would need a **BFF / token-proxy** that
> holds the service credentials and brokers each `chat` call. That proxy is out
> of scope for this SDK; there is no React binding for the AI Service.
>
> The **model is server-fixed** per tenant — there is no `model` parameter.

## Text & completions

```ts
// single-shot text generation (supports maxTokens)
const { result } = await client.ai.generateText({ prompt: "Summarize…", maxTokens: 256 });

// multi-turn chat completion (no maxTokens; role ∈ USER | SYSTEM | ASSISTANT)
const completion = await client.ai.complete({
  messages: [
    { role: "SYSTEM", content: "You are a concise assistant." },
    { role: "USER", content: "What is Emporix?" },
  ],
});
completion.result;
```

## Agents (CRUD)

```ts
const agents = await client.ai.listAgents();
const agent = await client.ai.getAgent("support-bot");
await client.ai.upsertAgent("support-bot", agent);

// PATCH uses the UPPERCASE op enum (ADD | REMOVE | REPLACE), NOT lowercase JSON-Patch
await client.ai.patchAgent("support-bot", [{ op: "REPLACE", path: "/name", value: "Helpdesk" }]);

const found = await client.ai.searchAgents({ name: "support" });

// force is required if the agent is still referenced elsewhere
await client.ai.deleteAgent("support-bot", undefined, { force: true });
```

## Agentic chat

Both chat endpoints **return arrays** — the SDK preserves them verbatim.

```ts
// synchronous — ChatResponse[]
const replies = await client.ai.chat({ agentId: "support-bot", message: "Where is my order?" });
replies[0]?.message;
replies[0]?.sessionId; // continue a session by threading this back

// asynchronous — JobIdResponse[] (HTTP 201)
const [{ jobId }] = await client.ai.chatAsync({ agentId: "support-bot", message: "…" });
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
(`deleteAgent`'s options object comes *after* `auth`:
`deleteAgent(id, auth, { force })`.)

## Out of scope

Templates, import/export, logs/sessions, and tokens endpoints are not yet bound.
The AI Service API is version `0.0.1` (unstable); shapes may change.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row in the workspace-layout table and add `AI` to the parenthesized service list (append before the closing paren, after the most recently added services such as `TenantConfig, ClientConfig` if present):

```
…, TenantConfig, ClientConfig, AI) | yes (`@viu/emporix-sdk`) |
```

(If those configuration services are not yet in the list on this branch, just append `, AI` before the closing paren of the existing list.)

- [ ] **Step 3: Commit**

```bash
git add docs/ai.md CLAUDE.md
git commit -m "docs(sdk): document the ai service"
```

---

## Task 6: Changeset

**Files:**
- Create: `.changeset/ai-service.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/ai-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix AI Service bindings via `client.ai`: text generation
(`generateText`), chat completions (`complete`), agent CRUD (`listAgents`,
`getAgent`, `upsertAgent`, `patchAgent`, `deleteAgent`, `searchAgents`), and
synchronous / asynchronous agentic chat (`chat`, `chatAsync`). Server-side only
— these use the service (clientCredentials) token and must not be called from a
browser; both chat endpoints return arrays. Templates, import/export,
logs/sessions and tokens are not yet bound.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` for a minor bump, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/ai-service.md
git commit -m "chore(release): add ai service changeset"
```

---

## Final verification (after all tasks)

- [ ] Run the full package suite + typecheck + lint:
```bash
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk lint
```
- [ ] Build so examples typecheck against the new dist surface:
```bash
pnpm -F @viu/emporix-sdk build
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 scope (texts, completions, agents CRUD, chat, chat-async) → every method in Task 3 (`generateText`/`complete`/`listAgents`/`getAgent`/`upsertAgent`/`patchAgent`/`deleteAgent`/`searchAgents`/`chat`/`chatAsync`). D2 no React → no React tasks. D3 one service `client.ai` → Task 4. D4 `deleteAgent` name → used in Task 3. D5 codegen + thin aliases → Tasks 1+2. D6 service-token default → `const SERVICE` in Task 3, every method defaults to it. D7 chat returns the array → `chat`/`chatAsync` return `[]`-typed, tests assert `Array.isArray`. Quirks: both arrays (D7/tests), no `model` (no param, doc note), `maxTokens` only on `/texts` (separate `TextRequest`/`CompletionRequest`), uppercase PATCH op (typed + asserted verbatim), `?force=true` (`deleteAgent` opts + test). Deferrals (templates/import-export/logs/tokens) → documented in spec §9, doc "Out of scope", changeset. Docs/changeset → Tasks 5/6. No gaps.
- **Placeholder scan:** No TBD/TODO. Every code step has full code. The two upstream-dependent uncertainties are concrete `grep` verifications with defined fallbacks, not placeholders: (a) generated type names (Task 1 Step 3 → alias swap or structural fallback in Task 2); (b) `op` enum casing (grep-confirmed in Task 1). The `query` boolean→string typing gotcha is called out inline with the exact fix.
- **Type consistency:** Public names `TextRequest`/`TextResponse`/`CompletionMessage`/`CompletionRequest`/`CompletionResponse`/`Agent`/`AgentPatchOp`/`AgentSearchQuery`/`ChatRequest`/`ChatResponse`/`JobIdResponse`/`DeleteAgentOptions` are identical across Task 2 (definitions), Task 3 (imports + re-exports), and the tests. Method names match across Task 3, Task 4 wiring test, and the doc. `request` (not `req`) used everywhere, matching `media.ts`/`tenant-config.ts`. The `ai.ts` facade re-exports via `export *`, and `ai.ts` (service) re-exports the public types so `@viu/emporix-sdk/ai` surfaces them.
- **Path / logger / wiring consistency:** logger name `"ai"` matches `mk("ai")` and the `ServiceName` addition. Base path `/ai-service/${tenant}` matches the spec §4 and the test `BASE`. Commit scopes are all `sdk`/`release` with lowercase verbs, satisfying commitlint.
