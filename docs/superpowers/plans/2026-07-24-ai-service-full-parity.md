# AI Service Full Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the `AiService` facade to full parity with the vendored `ai-service` OpenAPI spec by adding the 44 unimplemented operations (tools, mcp-servers, tokens, oauths, jobs, templates, logs, analytics, models, commerce-events, attachments, export/import).

**Architecture:** Purely additive. A generic `AgenticCrudResource<Read, Write>` implements the four symmetric CRUD families (tools/mcp-servers/tokens/oauths), exposed as lazy getters on `AiService`. Asymmetric families get small bespoke resource classes (`JobsResource`, `TemplatesResource`, `LogsResource`, `AnalyticsResource`). Single/irregular ops stay as flat methods on `AiService`. Existing methods are untouched.

**Tech Stack:** TypeScript, Vitest + MSW (`msw/node`), generated types from `@hey-api/openapi-ts` under `src/generated/ai-service`.

## Global Constraints

- Branch: `feat/ai-service-parity`, already created off `chore/emporix-api-sync` (where the new generated types live). Do NOT rebase onto `main` until the sync PR #153 has merged.
- Every facade method defaults its trailing `auth` arg to `const SERVICE: AuthContext = { kind: "service" }`. Server-side only.
- HTTP is always `this.ctx.http.request<T>({ method, path, auth, query?, body?, headers? })`. `RequestOptions.query` is `Record<string, string | number | undefined>`; `headers` is `Record<string, string>`.
- `AiService.base()` returns `/ai-service/${this.ctx.tenant}` (private method, already exists).
- PATCH bodies use the upstream UPPERCASE op enum (`ADD | REMOVE | REPLACE`), sent verbatim — NOT RFC-6902.
- All new public types are re-exported from `services/ai.ts` (mirror the existing `export type { … } from "./ai-types"` block).
- Commit scope MUST be from the commitlint allowlist: use `sdk` for code, `docs` for docs-only. Subject's first word after the scope is a lowercase verb.
- Run unit tests from inside the package: `cd packages/sdk && pnpm exec vitest run <file>`. Typecheck: `cd packages/sdk && pnpm exec tsc --noEmit`.
- Husky pre-commit runs repo-wide lint + typecheck; keep the tree green at every commit.

---

## File Structure

- Create `packages/sdk/src/services/ai-resources.ts` — the generic `AgenticCrudResource` + the four bespoke resource classes.
- Modify `packages/sdk/src/services/ai-types.ts` — add read/write aliases + shared option interfaces.
- Modify `packages/sdk/src/services/ai.ts` — add getters + standalone methods + re-exports.
- Create test files under `packages/sdk/tests/services/`: `ai-oauths.test.ts`, `ai-tools.test.ts`, `ai-tokens.test.ts`, `ai-mcp-servers.test.ts`, `ai-jobs.test.ts`, `ai-templates.test.ts`, `ai-logs.test.ts`, `ai-analytics.test.ts`, `ai-misc.test.ts`.
- Modify `docs/ai.md`, `docs/emporix-upstream-changelog.md`; create `.changeset/ai-service-full-parity.md`.

**Shared test harness** (copy verbatim into each new test file, changing only the `describe`/handlers). This mirrors `tests/services/schema-bulk.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { AiService } from "../../src/services/ai";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
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
```

---

## Task 1: Generic CRUD resource + shared types + `oauths` family

**Files:**
- Create: `packages/sdk/src/services/ai-resources.ts`
- Modify: `packages/sdk/src/services/ai-types.ts`
- Modify: `packages/sdk/src/services/ai.ts`
- Test: `packages/sdk/tests/services/ai-oauths.test.ts`

**Interfaces:**
- Produces: `AgenticCrudResource<Read, Write>` with `list(query?, auth?)`, `search(query, auth?)`, `get(id, opts?, auth?)`, `upsert(id, body, opts?, auth?)`, `patch(id, ops, auth?)`, `delete(id, opts?, auth?)`. Shared types `ListQuery`, `GetOptions`, `MutateOptions`, `SearchQuery`, `AgenticPatchOp`, `Created`. Getter `AiService.oauths` typed `AgenticCrudResource<OAuthConfig, OAuthInput>`.

- [ ] **Step 1: Add shared types + oauth aliases to `ai-types.ts`**

Append to the import block from `../generated/ai-service` these names: `IdResponse as GenIdResponse`, `OAuthResponse as GenOAuthResponse`, `OauthUpsertBody as GenOAuthInput`. Then add:

```ts
/** `{ id? }` — returned by an upsert on create (HTTP 201). */
export type Created = GenIdResponse;

/**
 * One PATCH op for any agentic resource. `op` is the upstream UPPERCASE enum
 * (`ADD | REMOVE | REPLACE`) — NOT RFC-6902. Passed verbatim. Same shape as
 * {@link AgentPatchOp}.
 */
export type AgenticPatchOp = GenPatchRequest[number];

/** Query for a CRUD `list` (`q`/paging/sort/fields/expand). Extra keys pass through. */
export interface ListQuery {
  q?: string;
  pageSize?: number;
  pageNumber?: number;
  sort?: string;
  fields?: string;
  expand?: string;
  [key: string]: string | number | undefined;
}

/** Options for a CRUD `get`. */
export interface GetOptions {
  fields?: string;
  expand?: string;
  [key: string]: string | number | undefined;
}

/** Options for a mutating CRUD call (`upsert`/`delete`). */
export interface MutateOptions {
  /** Cascade even if the entity is referenced elsewhere (`?force=true`). */
  force?: boolean;
}

/** Body for any agentic `/search` endpoint. */
export interface SearchQuery {
  q?: string;
}

/** An OAuth 2.0 client-credentials configuration (read shape). */
export type OAuthConfig = GenOAuthResponse;
/** Write shape for {@link AiService.oauths}`.upsert` (`OAuthRequest`). */
export type OAuthInput = GenOAuthInput;
```

Note: `GenPatchRequest` is already imported in `ai-types.ts` (used by `AgentPatchOp`). Reuse it; do not re-import.

- [ ] **Step 2: Create `ai-resources.ts` with the generic resource**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  AgenticPatchOp,
  ListQuery,
  GetOptions,
  MutateOptions,
  SearchQuery,
  Created,
} from "./ai-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * A symmetric CRUD resource over an agentic sub-collection (`tools`,
 * `mcp-servers`, `tokens`, `oauths`). All six operations share the upstream
 * shape; only the base path and the Read/Write types differ. Server-side only
 * — every call defaults to the SERVICE (backend) token.
 */
export class AgenticCrudResource<Read, Write> {
  constructor(
    private readonly ctx: ClientContext,
    private readonly path: string,
  ) {}

  private item(id: string): string {
    return `${this.path}/${encodeURIComponent(id)}`;
  }

  /** List the collection (`GET {path}`). Optional `q`/paging/sort/fields/expand. */
  list(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<Read[]> {
    return this.ctx.http.request<Read[]>({ method: "GET", path: this.path, auth, query: { ...query } });
  }

  /** Structured search (`POST {path}/search`). Body is `{ q? }`. */
  search(query: SearchQuery, auth: AuthContext = SERVICE): Promise<Read[]> {
    return this.ctx.http.request<Read[]>({ method: "POST", path: `${this.path}/search`, auth, body: query });
  }

  /** Retrieve one entry by id (`GET {path}/{id}`). */
  get(id: string, opts: GetOptions = {}, auth: AuthContext = SERVICE): Promise<Read> {
    return this.ctx.http.request<Read>({ method: "GET", path: this.item(id), auth, query: { ...opts } });
  }

  /**
   * Create-or-replace by id (`PUT {path}/{id}`). Resolves to `{ id }` on create
   * (HTTP 201) and `undefined` on update (HTTP 204). `{ force: true }`
   * cascade-disables dependents.
   */
  upsert(
    id: string,
    body: Write,
    opts: MutateOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<Created | undefined> {
    return this.ctx.http.request<Created | undefined>({
      method: "PUT",
      path: this.item(id),
      auth,
      body,
      ...(opts.force ? { query: { force: "true" } } : {}),
    });
  }

  /**
   * Partial update with an op array (`PATCH {path}/{id}`, 204). `ops` use the
   * upstream UPPERCASE enum (`ADD | REMOVE | REPLACE`), sent verbatim.
   */
  async patch(id: string, ops: AgenticPatchOp[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PATCH", path: this.item(id), auth, body: ops });
  }

  /** Delete by id (`DELETE {path}/{id}`). `{ force: true }` removes even if referenced. */
  async delete(id: string, opts: MutateOptions = {}, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: this.item(id),
      auth,
      ...(opts.force ? { query: { force: "true" } } : {}),
    });
  }
}
```

- [ ] **Step 3: Wire the `oauths` getter into `ai.ts`**

Add the import near the top: `import { AgenticCrudResource } from "./ai-resources";`. Add `OAuthConfig`, `OAuthInput` (and the shared option types `ListQuery`, `GetOptions`, `MutateOptions`, `SearchQuery`, `AgenticPatchOp`, `Created`) to BOTH the `import type { … } from "./ai-types"` block and the `export type { … } from "./ai-types"` block. Then inside the `AiService` class body add:

```ts
  private _oauths?: AgenticCrudResource<OAuthConfig, OAuthInput>;
  /** OAuth 2.0 client-credentials configs (`/agentic/oauths`). CRUD sub-resource. */
  get oauths(): AgenticCrudResource<OAuthConfig, OAuthInput> {
    return (this._oauths ??= new AgenticCrudResource(this.ctx, `${this.base()}/agentic/oauths`));
  }
```

- [ ] **Step 4: Write the failing test `ai-oauths.test.ts`**

Use the shared harness (top of this plan), then:

```ts
describe("AiService.oauths", () => {
  it("lists with expand + paging forwarded as query", async () => {
    let url: URL | null = null;
    server.use(
      http.get(`${BASE}/agentic/oauths`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([{ id: "gh" }]);
      }),
    );
    const res = await svc().oauths.list({ expand: "token", pageSize: 10 });
    expect(res).toEqual([{ id: "gh" }]);
    expect(url!.searchParams.get("expand")).toBe("token");
    expect(url!.searchParams.get("pageSize")).toBe("10");
  });

  it("upsert returns { id } on 201 create", async () => {
    server.use(
      http.put(`${BASE}/agentic/oauths/gh`, () => HttpResponse.json({ id: "gh" }, { status: 201 })),
    );
    const created = await svc().oauths.upsert("gh", {
      url: "https://example.com/token",
      clientId: "cid",
      grantType: "client_credentials",
    });
    expect(created).toEqual({ id: "gh" });
  });

  it("upsert returns undefined on 204 update and forwards ?force", async () => {
    let url: URL | null = null;
    server.use(
      http.put(`${BASE}/agentic/oauths/gh`, ({ request }) => {
        url = new URL(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await svc().oauths.upsert(
      "gh",
      { url: "https://example.com/token", clientId: "cid", grantType: "client_credentials" },
      { force: true },
    );
    expect(res).toBeUndefined();
    expect(url!.searchParams.get("force")).toBe("true");
  });

  it("patch sends the UPPERCASE op array verbatim", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/agentic/oauths/gh`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().oauths.patch("gh", [{ op: "REPLACE", path: "/enabled", value: "false" }]);
    expect(body).toEqual([{ op: "REPLACE", path: "/enabled", value: "false" }]);
  });

  it("delete forwards ?force=true", async () => {
    let url: URL | null = null;
    server.use(
      http.delete(`${BASE}/agentic/oauths/gh`, ({ request }) => {
        url = new URL(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().oauths.delete("gh", { force: true });
    expect(url!.searchParams.get("force")).toBe("true");
  });

  it("search posts { q } to /search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/oauths/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "gh" }]);
      }),
    );
    const res = await svc().oauths.search({ q: "grantType:client_credentials" });
    expect(res).toEqual([{ id: "gh" }]);
    expect(body).toEqual({ q: "grantType:client_credentials" });
  });
});
```

- [ ] **Step 5: Run the test — expect FAIL**

Run: `cd packages/sdk && pnpm exec vitest run tests/services/ai-oauths.test.ts`
Expected: FAIL (`oauths` getter / `AgenticCrudResource` not defined) until Steps 1–3 are saved. (If you did Steps 1–3 first, it PASSES here — that's fine; the point is the test exists and passes only with the code.)

- [ ] **Step 6: Run typecheck + the test — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-oauths.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/ai-resources.ts packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-oauths.test.ts
git commit -m "feat(sdk): add agentic crud resource and ai.oauths"
```

---

## Task 2: `tools`, `tokens`, `mcpServers` families

Three mechanically-identical getters reusing `AgenticCrudResource`. Batched: a reviewer accepts/rejects them together.

**Files:**
- Modify: `packages/sdk/src/services/ai-types.ts`
- Modify: `packages/sdk/src/services/ai.ts`
- Test: `packages/sdk/tests/services/ai-tools.test.ts`, `ai-tokens.test.ts`, `ai-mcp-servers.test.ts`

**Interfaces:**
- Consumes: `AgenticCrudResource` (Task 1).
- Produces: getters `AiService.tools` (`<Tool, ToolInput>`), `AiService.tokens` (`<Token, TokenInput>`), `AiService.mcpServers` (`<McpServer, McpServerInput>`).

- [ ] **Step 1: Add aliases to `ai-types.ts`**

Add to the generated-import block: `NativeToolsResponse as GenNativeTools`, `ToolUpsertBody as GenToolInput`, `TokenResponse as GenToken`, `TokenUpsertBody as GenTokenInput`, `McpServerResponse as GenMcpServer`, `McpServerUpsertBody as GenMcpServerInput`. Then:

```ts
/** One agentic tool (union of the native-tool response variants). */
export type Tool = GenNativeTools[number];
/** Write shape for {@link AiService.tools}`.upsert`. */
export type ToolInput = GenToolInput;

/** A stored token (holds an OAuth client secret, referenced by OAuth configs). */
export type Token = GenToken;
/** Write shape for {@link AiService.tokens}`.upsert`. */
export type TokenInput = GenTokenInput;

/** An MCP-server configuration for the agentic layer. */
export type McpServer = GenMcpServer;
/** Write shape for {@link AiService.mcpServers}`.upsert`. */
export type McpServerInput = GenMcpServerInput;
```

- [ ] **Step 2: Add the three getters to `ai.ts`**

Add `Tool`, `ToolInput`, `Token`, `TokenInput`, `McpServer`, `McpServerInput` to the import-type and export-type blocks. Then in the class:

```ts
  private _tools?: AgenticCrudResource<Tool, ToolInput>;
  /** Agentic tools (`/agentic/tools`). CRUD sub-resource. */
  get tools(): AgenticCrudResource<Tool, ToolInput> {
    return (this._tools ??= new AgenticCrudResource(this.ctx, `${this.base()}/agentic/tools`));
  }

  private _tokens?: AgenticCrudResource<Token, TokenInput>;
  /** Stored tokens (`/agentic/tokens`) — an OAuth config's client secret. CRUD sub-resource. */
  get tokens(): AgenticCrudResource<Token, TokenInput> {
    return (this._tokens ??= new AgenticCrudResource(this.ctx, `${this.base()}/agentic/tokens`));
  }

  private _mcpServers?: AgenticCrudResource<McpServer, McpServerInput>;
  /** MCP-server configs (`/agentic/mcp-servers`). CRUD sub-resource. */
  get mcpServers(): AgenticCrudResource<McpServer, McpServerInput> {
    return (this._mcpServers ??= new AgenticCrudResource(this.ctx, `${this.base()}/agentic/mcp-servers`));
  }
```

- [ ] **Step 3: Write the three failing tests**

`ai-tools.test.ts` (harness + this; `describe("AiService.tools")`):

```ts
describe("AiService.tools", () => {
  it("gets a single tool by id", async () => {
    server.use(http.get(`${BASE}/agentic/tools/t1`, () => HttpResponse.json({ id: "t1", type: "slack" })));
    const res = await svc().tools.get("t1");
    expect(res).toEqual({ id: "t1", type: "slack" });
  });
  it("lists tools", async () => {
    server.use(http.get(`${BASE}/agentic/tools`, () => HttpResponse.json([{ id: "t1" }])));
    expect(await svc().tools.list()).toEqual([{ id: "t1" }]);
  });
});
```

`ai-tokens.test.ts` (`describe("AiService.tokens")`):

```ts
describe("AiService.tokens", () => {
  it("upserts a token and returns { id } on 201", async () => {
    server.use(http.put(`${BASE}/agentic/tokens/tok1`, () => HttpResponse.json({ id: "tok1" }, { status: 201 })));
    const res = await svc().tokens.upsert("tok1", { name: "gh-secret", value: "s3cr3t" });
    expect(res).toEqual({ id: "tok1" });
  });
  it("deletes a token", async () => {
    server.use(http.delete(`${BASE}/agentic/tokens/tok1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().tokens.delete("tok1")).resolves.toBeUndefined();
  });
});
```

`ai-mcp-servers.test.ts` (`describe("AiService.mcpServers")`):

```ts
describe("AiService.mcpServers", () => {
  it("lists mcp servers at the hyphenated path", async () => {
    let hit = false;
    server.use(http.get(`${BASE}/agentic/mcp-servers`, () => { hit = true; return HttpResponse.json([{ id: "m1" }]); }));
    expect(await svc().mcpServers.list()).toEqual([{ id: "m1" }]);
    expect(hit).toBe(true);
  });
  it("patches an mcp server", async () => {
    let body: unknown = null;
    server.use(http.patch(`${BASE}/agentic/mcp-servers/m1`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }));
    await svc().mcpServers.patch("m1", [{ op: "REPLACE", path: "/name", value: "renamed" }]);
    expect(body).toEqual([{ op: "REPLACE", path: "/name", value: "renamed" }]);
  });
});
```

- [ ] **Step 4: Run typecheck + tests — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-tools.test.ts tests/services/ai-tokens.test.ts tests/services/ai-mcp-servers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-tools.test.ts packages/sdk/tests/services/ai-tokens.test.ts packages/sdk/tests/services/ai-mcp-servers.test.ts
git commit -m "feat(sdk): add ai.tools, ai.tokens and ai.mcpServers"
```

---

## Task 3: `jobs` resource

**Files:**
- Modify: `packages/sdk/src/services/ai-resources.ts`, `ai-types.ts`, `ai.ts`
- Test: `packages/sdk/tests/services/ai-jobs.test.ts`

**Interfaces:**
- Produces: `JobsResource` with `list(query?, auth?): Promise<Job[]>`, `search(query, auth?): Promise<Job[]>`, `get(jobId, auth?): Promise<Job>`, `delete(jobId, auth?): Promise<void>`. Getter `AiService.jobs`. Type `Job`.
- Note: jobs live at `/ai-service/{tenant}/jobs` — pass the AI base (`/ai-service/${tenant}`), NOT the agentic path.

- [ ] **Step 1: Add `Job` alias to `ai-types.ts`**

Add `Job as GenJob` to the generated-import block, then:

```ts
/** An async AI job (`IMPORT` / `EXPORT` / `AGENT_CHAT`) with status + result. */
export type Job = GenJob;
```

- [ ] **Step 2: Add `JobsResource` to `ai-resources.ts`**

```ts
import type { Job } from "./ai-types";

/**
 * AI async jobs (`/ai-service/{tenant}/jobs`). NOTE: not under `/agentic`.
 * `chatAsync` returns a `jobId`; poll/list/delete it here.
 */
export class JobsResource {
  constructor(
    private readonly ctx: ClientContext,
    private readonly base: string,
  ) {}

  /** List jobs (`GET /jobs`). */
  list(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<Job[]> {
    return this.ctx.http.request<Job[]>({ method: "GET", path: `${this.base}/jobs`, auth, query: { ...query } });
  }
  /** Structured job search (`POST /jobs/search`). */
  search(query: SearchQuery, auth: AuthContext = SERVICE): Promise<Job[]> {
    return this.ctx.http.request<Job[]>({ method: "POST", path: `${this.base}/jobs/search`, auth, body: query });
  }
  /** Retrieve one job (`GET /jobs/{jobId}`). */
  get(jobId: string, auth: AuthContext = SERVICE): Promise<Job> {
    return this.ctx.http.request<Job>({ method: "GET", path: `${this.base}/jobs/${encodeURIComponent(jobId)}`, auth });
  }
  /** Delete one job (`DELETE /jobs/{jobId}`). */
  async delete(jobId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "DELETE", path: `${this.base}/jobs/${encodeURIComponent(jobId)}`, auth });
  }
}
```

(Extend the existing `import type { … } from "./ai-types"` at the top of `ai-resources.ts` to include `Job`.)

- [ ] **Step 3: Wire the getter into `ai.ts`**

Add `JobsResource` to the `./ai-resources` import and `Job` to the type import/export blocks. Then:

```ts
  private _jobs?: JobsResource;
  /** AI async jobs (`/jobs`). `list · search · get · delete`. */
  get jobs(): JobsResource {
    return (this._jobs ??= new JobsResource(this.ctx, this.base()));
  }
```

- [ ] **Step 4: Write the failing test `ai-jobs.test.ts`**

```ts
describe("AiService.jobs", () => {
  it("lists jobs at the non-agentic /jobs path", async () => {
    let hit = false;
    server.use(http.get(`${BASE}/jobs`, () => { hit = true; return HttpResponse.json([{ id: "j1", status: "success" }]); }));
    expect(await svc().jobs.list()).toEqual([{ id: "j1", status: "success" }]);
    expect(hit).toBe(true);
  });
  it("gets and deletes a job by id", async () => {
    server.use(
      http.get(`${BASE}/jobs/j1`, () => HttpResponse.json({ id: "j1", status: "in_progress" })),
      http.delete(`${BASE}/jobs/j1`, () => new HttpResponse(null, { status: 204 })),
    );
    expect(await svc().jobs.get("j1")).toEqual({ id: "j1", status: "in_progress" });
    await expect(svc().jobs.delete("j1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Run typecheck + test — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-jobs.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/ai-resources.ts packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-jobs.test.ts
git commit -m "feat(sdk): add ai.jobs resource"
```

---

## Task 4: `templates` resource

**Files:**
- Modify: `packages/sdk/src/services/ai-resources.ts`, `ai-types.ts`, `ai.ts`
- Test: `packages/sdk/tests/services/ai-templates.test.ts`

**Interfaces:**
- Produces: `TemplatesResource` with `list(query?, auth?): Promise<AgentTemplate[]>`, `search(query, auth?): Promise<AgentTemplate[]>`, `clone(templateId, body, auth?): Promise<Created>`. Getter `AiService.templates`. Types `AgentTemplate`, `AgentFromTemplate`.

- [ ] **Step 1: Add aliases to `ai-types.ts`**

Add `AgentTemplateResponse as GenAgentTemplate`, `AgentFromTemplateRequest as GenAgentFromTemplate` to the generated-import block, then:

```ts
/** An available agent template. */
export type AgentTemplate = GenAgentTemplate;
/** Body for {@link AiService.templates}`.clone` — the user prompt + overrides. */
export type AgentFromTemplate = GenAgentFromTemplate;
```

- [ ] **Step 2: Add `TemplatesResource` to `ai-resources.ts`**

Extend the `./ai-types` import with `AgentTemplate`, `AgentFromTemplate`, `Created`. Then:

```ts
import type { AgentTemplate, AgentFromTemplate } from "./ai-types";

/** Agent templates (`/agentic/templates`). `list · search · clone`. */
export class TemplatesResource {
  constructor(
    private readonly ctx: ClientContext,
    private readonly path: string, // `${base}/agentic/templates`
  ) {}

  /** List available templates (`GET /agentic/templates`). */
  list(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<AgentTemplate[]> {
    return this.ctx.http.request<AgentTemplate[]>({ method: "GET", path: this.path, auth, query: { ...query } });
  }
  /** Structured template search (`POST /agentic/templates/search`). */
  search(query: SearchQuery, auth: AuthContext = SERVICE): Promise<AgentTemplate[]> {
    return this.ctx.http.request<AgentTemplate[]>({ method: "POST", path: `${this.path}/search`, auth, body: query });
  }
  /**
   * Instantiate a new agent from a template
   * (`POST /agentic/templates/{templateId}/agents`, HTTP 201). Returns the
   * created agent's id.
   */
  clone(templateId: string, body: AgentFromTemplate, auth: AuthContext = SERVICE): Promise<Created> {
    return this.ctx.http.request<Created>({
      method: "POST",
      path: `${this.path}/${encodeURIComponent(templateId)}/agents`,
      auth,
      body,
    });
  }
}
```

- [ ] **Step 3: Wire the getter into `ai.ts`**

Add `TemplatesResource` to the `./ai-resources` import; add `AgentTemplate`, `AgentFromTemplate` to the type import/export blocks. Then:

```ts
  private _templates?: TemplatesResource;
  /** Agent templates (`/agentic/templates`). `list · search · clone`. */
  get templates(): TemplatesResource {
    return (this._templates ??= new TemplatesResource(this.ctx, `${this.base()}/agentic/templates`));
  }
```

- [ ] **Step 4: Write the failing test `ai-templates.test.ts`**

```ts
describe("AiService.templates", () => {
  it("lists templates", async () => {
    server.use(http.get(`${BASE}/agentic/templates`, () => HttpResponse.json([{ id: "support" }])));
    expect(await svc().templates.list()).toEqual([{ id: "support" }]);
  });
  it("clone posts to /templates/{id}/agents and returns the new agent id", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/templates/support/agents`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "agent-1" }, { status: 201 });
      }),
    );
    const created = await svc().templates.clone("support", { userPrompt: "Handle returns" } as never);
    expect(created).toEqual({ id: "agent-1" });
    expect(body).toEqual({ userPrompt: "Handle returns" });
  });
});
```

- [ ] **Step 5: Run typecheck + test — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-templates.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/ai-resources.ts packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-templates.test.ts
git commit -m "feat(sdk): add ai.templates resource"
```

---

## Task 5: `logs` resource

**Files:**
- Modify: `packages/sdk/src/services/ai-resources.ts`, `ai-types.ts`, `ai.ts`
- Test: `packages/sdk/tests/services/ai-logs.test.ts`

**Interfaces:**
- Produces: `LogsResource` with `listRequests(query?, auth?): Promise<AgentRequestLog[]>`, `getRequest(id, auth?): Promise<AgentRequestLog>`, `searchRequests(query, auth?): Promise<AgentRequestLog[]>`, `listSessions(query?, auth?): Promise<AgentSessionLog[]>`, `getSession(id, auth?): Promise<AgentSessionLog>`, `searchSessions(query, auth?): Promise<AgentSessionLog[]>`. Getter `AiService.logs`. Types `AgentRequestLog`, `AgentSessionLog`.

- [ ] **Step 1: Add aliases to `ai-types.ts`**

Add `AgentRequestResponse as GenAgentRequestLog`, `AgentSessionResponse as GenAgentSessionLog` to the generated-import block, then:

```ts
/** One agent request-log entry. */
export type AgentRequestLog = GenAgentRequestLog;
/** One agent session-log entry. */
export type AgentSessionLog = GenAgentSessionLog;
```

- [ ] **Step 2: Add `LogsResource` to `ai-resources.ts`**

Extend the `./ai-types` import with `AgentRequestLog`, `AgentSessionLog`. Then:

```ts
import type { AgentRequestLog, AgentSessionLog } from "./ai-types";

/** Agent logs (`/agentic/logs`): request logs and session logs. */
export class LogsResource {
  constructor(
    private readonly ctx: ClientContext,
    private readonly path: string, // `${base}/agentic/logs`
  ) {}

  /** List request logs (`GET /agentic/logs/requests`). */
  listRequests(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<AgentRequestLog[]> {
    return this.ctx.http.request<AgentRequestLog[]>({ method: "GET", path: `${this.path}/requests`, auth, query: { ...query } });
  }
  /** Retrieve one request log (`GET /agentic/logs/requests/{requestId}`). */
  getRequest(requestId: string, auth: AuthContext = SERVICE): Promise<AgentRequestLog> {
    return this.ctx.http.request<AgentRequestLog>({ method: "GET", path: `${this.path}/requests/${encodeURIComponent(requestId)}`, auth });
  }
  /** Structured request-log search (`POST /agentic/logs/requests/search`). */
  searchRequests(query: SearchQuery, auth: AuthContext = SERVICE): Promise<AgentRequestLog[]> {
    return this.ctx.http.request<AgentRequestLog[]>({ method: "POST", path: `${this.path}/requests/search`, auth, body: query });
  }
  /** List session logs (`GET /agentic/logs/sessions`). */
  listSessions(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<AgentSessionLog[]> {
    return this.ctx.http.request<AgentSessionLog[]>({ method: "GET", path: `${this.path}/sessions`, auth, query: { ...query } });
  }
  /** Retrieve one session log (`GET /agentic/logs/sessions/{sessionId}`). */
  getSession(sessionId: string, auth: AuthContext = SERVICE): Promise<AgentSessionLog> {
    return this.ctx.http.request<AgentSessionLog>({ method: "GET", path: `${this.path}/sessions/${encodeURIComponent(sessionId)}`, auth });
  }
  /** Structured session-log search (`POST /agentic/logs/sessions/search`). */
  searchSessions(query: SearchQuery, auth: AuthContext = SERVICE): Promise<AgentSessionLog[]> {
    return this.ctx.http.request<AgentSessionLog[]>({ method: "POST", path: `${this.path}/sessions/search`, auth, body: query });
  }
}
```

- [ ] **Step 3: Wire the getter into `ai.ts`**

Add `LogsResource` to the `./ai-resources` import; add `AgentRequestLog`, `AgentSessionLog` to the type import/export blocks. Then:

```ts
  private _logs?: LogsResource;
  /** Agent logs (`/agentic/logs`): request + session logs. */
  get logs(): LogsResource {
    return (this._logs ??= new LogsResource(this.ctx, `${this.base()}/agentic/logs`));
  }
```

- [ ] **Step 4: Write the failing test `ai-logs.test.ts`**

```ts
describe("AiService.logs", () => {
  it("lists request logs", async () => {
    server.use(http.get(`${BASE}/agentic/logs/requests`, () => HttpResponse.json([{ id: "r1" }])));
    expect(await svc().logs.listRequests()).toEqual([{ id: "r1" }]);
  });
  it("gets a session log by id", async () => {
    server.use(http.get(`${BASE}/agentic/logs/sessions/s1`, () => HttpResponse.json({ id: "s1" })));
    expect(await svc().logs.getSession("s1")).toEqual({ id: "s1" });
  });
  it("searches session logs", async () => {
    let body: unknown = null;
    server.use(http.post(`${BASE}/agentic/logs/sessions/search`, async ({ request }) => { body = await request.json(); return HttpResponse.json([{ id: "s1" }]); }));
    expect(await svc().logs.searchSessions({ q: "severity:ERROR" })).toEqual([{ id: "s1" }]);
    expect(body).toEqual({ q: "severity:ERROR" });
  });
});
```

- [ ] **Step 5: Run typecheck + test — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-logs.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/ai-resources.ts packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-logs.test.ts
git commit -m "feat(sdk): add ai.logs resource"
```

---

## Task 6: `analytics` resource

**Files:**
- Modify: `packages/sdk/src/services/ai-resources.ts`, `ai-types.ts`, `ai.ts`
- Test: `packages/sdk/tests/services/ai-analytics.test.ts`

**Interfaces:**
- Produces: `AnalyticsResource` with `get(opts?: AnalyticsQuery, auth?): Promise<AgentAnalytics>` and `executions(query: ExecutionsQuery, auth?): Promise<AgentExecutions>`. Getter `AiService.analytics`. Types `AgentAnalytics`, `AgentExecutions`, `AnalyticsQuery`, `ExecutionsQuery`.

- [ ] **Step 1: Add types to `ai-types.ts`**

Add `AgentAnalyticsResponse as GenAgentAnalytics`, `ExecutionsResponse as GenAgentExecutions` to the generated-import block, then:

```ts
/** Aggregated agent analytics (request/session metrics, trends). */
export type AgentAnalytics = GenAgentAnalytics;
/** Per-agent execution counts aligned to returned periods. */
export type AgentExecutions = GenAgentExecutions;

/** Query for {@link AiService.analytics}`.get`. */
export interface AnalyticsQuery {
  /** Scope metrics to one agent; omit for tenant-wide aggregates. */
  agentId?: string;
}
/** Query for {@link AiService.analytics}`.executions` — `agentIds` is required. */
export interface ExecutionsQuery {
  /** Comma-separated agent IDs (no spaces, ≤100). */
  agentIds: string;
  /** Time bucket per period (UTC). */
  granularity?: "QUARTER" | "MONTH" | "WEEK";
}
```

- [ ] **Step 2: Add `AnalyticsResource` to `ai-resources.ts`**

Extend the `./ai-types` import with `AgentAnalytics`, `AgentExecutions`, `AnalyticsQuery`, `ExecutionsQuery`. Then:

```ts
import type { AgentAnalytics, AgentExecutions, AnalyticsQuery, ExecutionsQuery } from "./ai-types";

/** Agent analytics (`/agentic/analytics`). */
export class AnalyticsResource {
  constructor(
    private readonly ctx: ClientContext,
    private readonly path: string, // `${base}/agentic/analytics`
  ) {}

  /** Aggregated metrics (`GET /agentic/analytics`); scope with `agentId`. */
  get(opts: AnalyticsQuery = {}, auth: AuthContext = SERVICE): Promise<AgentAnalytics> {
    return this.ctx.http.request<AgentAnalytics>({ method: "GET", path: this.path, auth, query: { ...opts } });
  }
  /** Per-agent execution counts (`GET /agentic/analytics/executions`). `agentIds` required. */
  executions(query: ExecutionsQuery, auth: AuthContext = SERVICE): Promise<AgentExecutions> {
    return this.ctx.http.request<AgentExecutions>({ method: "GET", path: `${this.path}/executions`, auth, query: { ...query } });
  }
}
```

- [ ] **Step 3: Wire the getter into `ai.ts`**

Add `AnalyticsResource` to the `./ai-resources` import; add `AgentAnalytics`, `AgentExecutions`, `AnalyticsQuery`, `ExecutionsQuery` to the type import/export blocks. Then:

```ts
  private _analytics?: AnalyticsResource;
  /** Agent analytics (`/agentic/analytics`). `get · executions`. */
  get analytics(): AnalyticsResource {
    return (this._analytics ??= new AnalyticsResource(this.ctx, `${this.base()}/agentic/analytics`));
  }
```

- [ ] **Step 4: Write the failing test `ai-analytics.test.ts`**

```ts
describe("AiService.analytics", () => {
  it("get forwards agentId", async () => {
    let url: URL | null = null;
    server.use(http.get(`${BASE}/agentic/analytics`, ({ request }) => { url = new URL(request.url); return HttpResponse.json({ requests: { total: 5 } }); }));
    const res = await svc().analytics.get({ agentId: "support" });
    expect(res).toEqual({ requests: { total: 5 } });
    expect(url!.searchParams.get("agentId")).toBe("support");
  });
  it("executions forwards agentIds + granularity", async () => {
    let url: URL | null = null;
    server.use(http.get(`${BASE}/agentic/analytics/executions`, ({ request }) => { url = new URL(request.url); return HttpResponse.json({ periods: [] }); }));
    await svc().analytics.executions({ agentIds: "a,b", granularity: "WEEK" });
    expect(url!.searchParams.get("agentIds")).toBe("a,b");
    expect(url!.searchParams.get("granularity")).toBe("WEEK");
  });
});
```

- [ ] **Step 5: Run typecheck + test — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-analytics.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/ai-resources.ts packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-analytics.test.ts
git commit -m "feat(sdk): add ai.analytics resource"
```

---

## Task 7: Standalone `listModels` + `listCommerceEvents`

**Files:**
- Modify: `packages/sdk/src/services/ai-types.ts`, `ai.ts`
- Test: `packages/sdk/tests/services/ai-misc.test.ts` (create; shared by Tasks 7–9)

**Interfaces:**
- Produces: `AiService.listModels(auth?): Promise<ProviderModels[]>`, `AiService.listCommerceEvents(auth?): Promise<CommerceEvents>`. Types `ProviderModels`, `CommerceEvents`.

- [ ] **Step 1: Add aliases to `ai-types.ts`**

Add `ProviderModelsResponse as GenProviderModels`, `CommerceEventsResponse as GenCommerceEvents` to the generated-import block, then:

```ts
/** Models available to the tenant, grouped by LLM provider. */
export type ProviderModels = GenProviderModels;
/** The set of commerce events an agent trigger can subscribe to. */
export type CommerceEvents = GenCommerceEvents;
```

- [ ] **Step 2: Add the two methods to `ai.ts`**

Add `ProviderModels`, `CommerceEvents` to the type import/export blocks. Then, alongside the existing flat methods:

```ts
  /** List models available to the tenant, grouped by provider (`GET /agentic/models`). */
  async listModels(auth: AuthContext = SERVICE): Promise<ProviderModels[]> {
    return this.ctx.http.request<ProviderModels[]>({ method: "GET", path: `${this.base()}/agentic/models`, auth });
  }

  /** List commerce events available to agent triggers (`GET /agentic/commerce-events`). */
  async listCommerceEvents(auth: AuthContext = SERVICE): Promise<CommerceEvents> {
    return this.ctx.http.request<CommerceEvents>({ method: "GET", path: `${this.base()}/agentic/commerce-events`, auth });
  }
```

- [ ] **Step 3: Write the failing test — add to `ai-misc.test.ts`**

Create `ai-misc.test.ts` with the shared harness, then:

```ts
describe("AiService.listModels / listCommerceEvents", () => {
  it("lists models", async () => {
    server.use(http.get(`${BASE}/agentic/models`, () => HttpResponse.json([{ provider: "openai", models: ["gpt-x"] }])));
    expect(await svc().listModels()).toEqual([{ provider: "openai", models: ["gpt-x"] }]);
  });
  it("lists commerce events", async () => {
    server.use(http.get(`${BASE}/agentic/commerce-events`, () => HttpResponse.json({ events: ["order.created"] })));
    expect(await svc().listCommerceEvents()).toEqual({ events: ["order.created"] });
  });
});
```

- [ ] **Step 4: Run typecheck + test — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-misc.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-misc.test.ts
git commit -m "feat(sdk): add ai.listModels and ai.listCommerceEvents"
```

---

## Task 8: `uploadAttachment` (multipart)

**Files:**
- Modify: `packages/sdk/src/services/ai-types.ts`, `ai.ts`
- Test: `packages/sdk/tests/services/ai-misc.test.ts` (append)

**Interfaces:**
- Produces: `AiService.uploadAttachment(agentId, attachment: Blob | File, opts?: AttachmentOptions, auth?): Promise<Attachment>`. Types `Attachment`, `AttachmentOptions`.

- [ ] **Step 1: Add types to `ai-types.ts`**

Add `AttachmentResponse as GenAttachment` to the generated-import block, then:

```ts
/** Result of an attachment upload — `{ id?, sessionId? }`. */
export type Attachment = GenAttachment;

/** Options for {@link AiService.uploadAttachment}. */
export interface AttachmentOptions {
  /** Reuse a chat context — sent as the `session-id` header. Thread the returned `sessionId` into chat calls. */
  sessionId?: string;
}
```

- [ ] **Step 2: Add the method to `ai.ts`**

Add `Attachment`, `AttachmentOptions` to the type import/export blocks. Then:

```ts
  /**
   * Upload a chat attachment for an agent
   * (`POST /agentic/{agentId}/attachments`, multipart, HTTP 201). The response
   * `sessionId` must be threaded into subsequent chat calls to bind the file.
   * Pass `opts.sessionId` to attach to an existing session.
   */
  async uploadAttachment(
    agentId: string,
    attachment: Blob | File,
    opts: AttachmentOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<Attachment> {
    const form = new FormData();
    form.append("attachment", attachment);
    return this.ctx.http.request<Attachment>({
      method: "POST",
      path: `${this.base()}/agentic/${encodeURIComponent(agentId)}/attachments`,
      auth,
      body: form,
      ...(opts.sessionId ? { headers: { "session-id": opts.sessionId } } : {}),
    });
  }
```

- [ ] **Step 3: Write the failing test — append to `ai-misc.test.ts`**

```ts
describe("AiService.uploadAttachment", () => {
  it("posts multipart form data and forwards session-id", async () => {
    let contentType: string | null = null;
    let sessionId: string | null = null;
    let fieldPresent = false;
    server.use(
      http.post(`${BASE}/agentic/bot/attachments`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        sessionId = request.headers.get("session-id");
        const fd = await request.formData();
        fieldPresent = fd.has("attachment");
        return HttpResponse.json({ id: "att-1", sessionId: "sess-9" }, { status: 201 });
      }),
    );
    const res = await svc().uploadAttachment("bot", new Blob(["hello"], { type: "text/plain" }), { sessionId: "sess-9" });
    expect(res).toEqual({ id: "att-1", sessionId: "sess-9" });
    expect(contentType).toMatch(/multipart\/form-data/);
    expect(sessionId).toBe("sess-9");
    expect(fieldPresent).toBe(true);
  });
});
```

- [ ] **Step 4: Run typecheck + test — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-misc.test.ts`
Expected: PASS (3 files-worth of `ai-misc` describes now; the attachment test included).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-misc.test.ts
git commit -m "feat(sdk): add ai.uploadAttachment"
```

---

## Task 9: `exportAgents` + `importAgents`

**Files:**
- Modify: `packages/sdk/src/services/ai-types.ts`, `ai.ts`
- Test: `packages/sdk/tests/services/ai-misc.test.ts` (append)

**Interfaces:**
- Produces: `AiService.exportAgents(body: AgentsExportRequest, auth?): Promise<AgentsExport>`, `AiService.importAgents(body: AgentsImportRequest, auth?): Promise<AgentsImport>`. Types `AgentsExport`, `AgentsExportRequest`, `AgentsImport`, `AgentsImportRequest`.

- [ ] **Step 1: Add types to `ai-types.ts`**

Add `ExportResponse as GenAgentsExport`, `ExportRequest as GenAgentsExportRequest`, `ImportResponse as GenAgentsImport`, `ImportRequest as GenAgentsImportRequest` to the generated-import block, then:

```ts
/** Base64+checksum export of agents with their components. */
export type AgentsExport = GenAgentsExport;
/** Body for {@link AiService.exportAgents} — `{ agentIds }`. */
export type AgentsExportRequest = GenAgentsExportRequest;
/** Result of an agents import. */
export type AgentsImport = GenAgentsImport;
/** Body for {@link AiService.importAgents} — `{ data, checksum }`. */
export type AgentsImportRequest = GenAgentsImportRequest;
```

- [ ] **Step 2: Add the two methods to `ai.ts`**

Add the four types to the import/export blocks. Then:

```ts
  /** Export agents + components as a base64/checksum blob (`POST /agentic/agents/export`). */
  async exportAgents(body: AgentsExportRequest, auth: AuthContext = SERVICE): Promise<AgentsExport> {
    return this.ctx.http.request<AgentsExport>({ method: "POST", path: `${this.base()}/agentic/agents/export`, auth, body });
  }

  /** Import previously-exported agents (`POST /agentic/agents/import`). */
  async importAgents(body: AgentsImportRequest, auth: AuthContext = SERVICE): Promise<AgentsImport> {
    return this.ctx.http.request<AgentsImport>({ method: "POST", path: `${this.base()}/agentic/agents/import`, auth, body });
  }
```

- [ ] **Step 3: Write the failing test — append to `ai-misc.test.ts`**

```ts
describe("AiService.exportAgents / importAgents", () => {
  it("exports the given agent ids", async () => {
    let body: unknown = null;
    server.use(http.post(`${BASE}/agentic/agents/export`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ data: "eyJ...", checksum: "abc" }); }));
    const res = await svc().exportAgents({ agentIds: ["a", "b"] });
    expect(res).toEqual({ data: "eyJ...", checksum: "abc" });
    expect(body).toEqual({ agentIds: ["a", "b"] });
  });
  it("imports a data+checksum blob", async () => {
    let body: unknown = null;
    server.use(http.post(`${BASE}/agentic/agents/import`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: "a" }); }));
    const res = await svc().importAgents({ data: "eyJ...", checksum: "abc" });
    expect(res).toEqual({ id: "a" });
    expect(body).toEqual({ data: "eyJ...", checksum: "abc" });
  });
});
```

- [ ] **Step 4: Run the full ai test suite + typecheck — expect PASS**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/ai-*.test.ts tests/services/ai.test.ts`
Expected: PASS across all ai test files.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai-types.ts packages/sdk/src/services/ai.ts packages/sdk/tests/services/ai-misc.test.ts
git commit -m "feat(sdk): add ai.exportAgents and ai.importAgents"
```

---

## Task 10: Docs, changelog, changeset

**Files:**
- Modify: `docs/ai.md`
- Modify: `docs/emporix-upstream-changelog.md`
- Create: `.changeset/ai-service-full-parity.md`

**Interfaces:** none (documentation + release metadata).

- [ ] **Step 1: Extend `docs/ai.md`**

After the existing "Conversations" section (before "Overriding the token"), add sections documenting the new surface. Include a short snippet per family. Example block to insert (adjust prose to match the file's voice):

````markdown
## Agent building blocks (`tools`, `mcpServers`, `tokens`, `oauths`)

Each is a uniform CRUD sub-resource: `list · search · get · upsert · patch · delete`.

```ts
const tools = await client.ai.tools.list();
const server = await client.ai.mcpServers.get("my-mcp");

// OAuth config + the token holding its client secret
const { id: tokenId } = (await client.ai.tokens.upsert("gh-secret", {
  name: "gh-secret", value: process.env.GH_SECRET!,
})) ?? {};
await client.ai.oauths.upsert("gh-app", {
  url: "https://github.com/login/oauth/access_token",
  clientId: "Iv1.abc",
  grantType: "client_credentials",
  clientSecretToken: { id: tokenId! },
});
```

`upsert` resolves to `{ id }` on create (HTTP 201) and `undefined` on update
(HTTP 204). `patch` uses the UPPERCASE op enum (`ADD | REMOVE | REPLACE`), not
RFC-6902. Pass `{ force: true }` to `upsert`/`delete` to cascade over
dependents.

## Jobs, templates, logs, analytics

```ts
const jobs = await client.ai.jobs.list();                 // /jobs (not /agentic)
const [{ jobId }] = await client.ai.chatAsync({ agentId: "bot", message: "…" });
const job = await client.ai.jobs.get(jobId);

const { id: agentId } = await client.ai.templates.clone("support", { userPrompt: "Handle returns" });

const errors = await client.ai.logs.searchSessions({ q: "severity:ERROR" });
const metrics = await client.ai.analytics.get({ agentId: "support" });
const exec = await client.ai.analytics.executions({ agentIds: "support,sales", granularity: "WEEK" });
```

## Models, commerce events, attachments, export/import

```ts
const models = await client.ai.listModels();
const events = await client.ai.listCommerceEvents();

const { sessionId } = await client.ai.uploadAttachment("bot", file); // file: Blob | File
await client.ai.chat({ agentId: "bot", message: "See attachment", sessionId } as never);

const bundle = await client.ai.exportAgents({ agentIds: ["bot"] });
await client.ai.importAgents({ data: bundle.data, checksum: bundle.checksum });
```
````

Also update the top-of-file summary sentence to mention the agentic building blocks, and remove the "not yet bound" note for templates/logs/tokens now that they exist. Leave the server-side-only caveat.

- [ ] **Step 2: Add a changelog entry to `docs/emporix-upstream-changelog.md`**

Insert at the top (above `## 2026-07-21`):

```markdown
## 2026-07-24 — synced (ai-service full parity)

Re-vendored specs; only `ai-service` changed (**6 new endpoints, 0 removed, 0
newly deprecated**) — the OAuth-config CRUD. Alongside the sync, the SDK's
`AiService` facade was brought to **full parity** with the ai-service spec.

### Endpoints

- **ai-service** — new `…/agentic/oauths` CRUD (list/search/get/upsert/patch/delete).
  SDK: added `ai.oauths`, plus the previously-unbound `ai.tools`, `ai.tokens`,
  `ai.mcpServers` (CRUD), `ai.jobs`, `ai.templates`, `ai.logs`, `ai.analytics`,
  and `ai.listModels` / `ai.listCommerceEvents` / `ai.uploadAttachment` /
  `ai.exportAgents` / `ai.importAgents`. 44 operations total.
```

- [ ] **Step 3: Create the changeset**

Create `.changeset/ai-service-full-parity.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add full `AiService` parity with the ai-service API. New CRUD sub-resources
`ai.tools`, `ai.mcpServers`, `ai.tokens`, `ai.oauths` (list/search/get/upsert/patch/delete);
new resource groups `ai.jobs`, `ai.templates`, `ai.logs`, `ai.analytics`; and
new methods `ai.listModels`, `ai.listCommerceEvents`, `ai.uploadAttachment`,
`ai.exportAgents`, `ai.importAgents`.
```

- [ ] **Step 4: Verify the whole package builds + tests + typechecks**

Run: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build`
Expected: typecheck clean, all tests pass, build writes `dist/`.

- [ ] **Step 5: Verify examples still typecheck against the built dist**

Run: `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build && pnpm typecheck`
Expected: repo-wide typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add docs/ai.md docs/emporix-upstream-changelog.md .changeset/ai-service-full-parity.md
git commit -m "docs(sdk): document ai-service full parity + changeset"
```

---

## Self-Review notes

- **Spec coverage:** every family in the spec's gap table maps to a task —
  oauths (T1), tools/tokens/mcpServers (T2), jobs (T3), templates (T4), logs
  (T5), analytics (T6), models+commerce-events (T7), attachments (T8),
  export/import (T9), docs/changeset (T10). 44 operations covered.
- **Type consistency:** the generic `AgenticCrudResource<Read, Write>` names are
  reused verbatim across T1–T2; each bespoke class defines its own methods;
  option interfaces (`ListQuery`/`GetOptions`/`MutateOptions`/`SearchQuery`/
  `AnalyticsQuery`/`ExecutionsQuery`) are defined once in T1/T6 and referenced.
- **Known quirk:** `tools.list()` is typed `Tool[]` despite the generated
  `Array<NativeToolsResponse>` (array-of-arrays) — an upstream schema quirk (see
  the design doc's Risks). Confirm against the live tenant at E2E time.
- **Ordering:** T1 must land first (defines the generic + shared types). T2–T9
  are independent of each other. T10 last (docs reference everything).
