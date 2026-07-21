# Emporix API Facade Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the 5 new endpoints from the 2026-07 Emporix sync through typed facade methods (including first-class SSE streaming in the HTTP core) and mark 2 deprecated facade wrappers.

**Architecture:** Add a pure SSE parser and a streaming method to the HTTP core, then add facade methods to `ai.ts`, `category.ts`, `schema.ts` that follow the existing `ctx.http.request(...)` pattern. All request/response shapes reuse the generated types. Deprecations are JSDoc-only (non-breaking).

**Tech Stack:** TypeScript, Vitest + MSW (`msw/node`), tsup build. Web-standard `fetch`/`ReadableStream`/`TextDecoder`.

## Global Constraints

- **Branch:** work on `feat/api-facade-extensions` (already created off `chore/emporix-api-sync`).
- **Commitlint:** `type(scope): lowercase-verb …`. Allowed scopes include `sdk, ai, category, core, docs, release`. First word after scope must be a lowercase verb.
- **Types:** every request body AND response types via generated schemas under `src/generated/**` — no hand-authored duplicate shapes. Re-export new public types through the service `*-types.ts` file.
- **Auth default:** AI + Schema facades default to `SERVICE` (`{ kind: "service" }`); Category reads default to `ANON` but the new write defaults to `SERVICE`.
- **Test harness:** mirror `tests/services/ai.test.ts` — `setupServer` from `msw/node`, the `svc()` factory building `HttpClient` + `DefaultTokenProvider` + `MemoryLogger`, `ClientContext = { tenant, http, tokenProvider, logger }`.
- **Commands:** run tests with `pnpm -F @viu/emporix-sdk test -- <file>`; typecheck with `pnpm -F @viu/emporix-sdk typecheck`.

---

### Task 1: SSE frame parser (`core/sse.ts`)

**Files:**
- Create: `packages/sdk/src/core/sse.ts`
- Test: `packages/sdk/tests/sse.test.ts`

**Interfaces:**
- Produces: `interface SseEvent { event?: string; data: string; id?: string }` and `async function* parseSseStream(chunks: AsyncIterable<string>): AsyncIterable<SseEvent>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/sdk/tests/sse.test.ts
import { describe, it, expect } from "vitest";
import { parseSseStream, type SseEvent } from "../src/core/sse";

async function* from(...parts: string[]): AsyncIterable<string> {
  for (const p of parts) yield p;
}
async function collect(chunks: AsyncIterable<string>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of parseSseStream(chunks)) out.push(e);
  return out;
}

describe("parseSseStream", () => {
  it("parses one event per blank-line-delimited frame", async () => {
    expect(await collect(from("data: hello\n\ndata: world\n\n"))).toEqual([
      { data: "hello" },
      { data: "world" },
    ]);
  });

  it("joins multiple data lines with newlines and reads event/id fields", async () => {
    expect(await collect(from("event: msg\nid: 7\ndata: a\ndata: b\n\n"))).toEqual([
      { event: "msg", id: "7", data: "a\nb" },
    ]);
  });

  it("reassembles frames split across chunk boundaries and normalizes CRLF", async () => {
    expect(await collect(from("data: ab", "c\r\n\r\ndata: d\n\n"))).toEqual([
      { data: "abc" },
      { data: "d" },
    ]);
  });

  it("ignores comment lines and flushes a trailing frame with no blank line", async () => {
    expect(await collect(from(": keep-alive\ndata: x\n\ndata: y"))).toEqual([
      { data: "x" },
      { data: "y" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk test -- tests/sse.test.ts`
Expected: FAIL — `Cannot find module '../src/core/sse'`.

- [ ] **Step 3: Implement the parser**

```typescript
// packages/sdk/src/core/sse.ts

/** One Server-Sent Events frame. `data` is the concatenated data lines. */
export interface SseEvent {
  event?: string;
  data: string;
  id?: string;
}

/** Parse one frame (fields separated by "\n"); returns undefined if it has no fields. */
function parseFrame(frame: string): SseEvent | undefined {
  const ev: SseEvent = { data: "" };
  const dataLines: string[] = [];
  let saw = false;
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // blank / comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1); // strip one leading space
    if (field === "data") { dataLines.push(value); saw = true; }
    else if (field === "event") { ev.event = value; saw = true; }
    else if (field === "id") { ev.id = value; saw = true; }
  }
  if (!saw) return undefined;
  ev.data = dataLines.join("\n");
  return ev;
}

/**
 * Parse an SSE byte stream (already decoded to text chunks) into events.
 * Buffers across chunk boundaries; frames are separated by a blank line.
 */
export async function* parseSseStream(
  chunks: AsyncIterable<string>,
): AsyncIterable<SseEvent> {
  let buf = "";
  for await (const chunk of chunks) {
    buf += chunk.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const ev = parseFrame(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (ev) yield ev;
    }
  }
  const tail = parseFrame(buf);
  if (tail) yield tail;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk test -- tests/sse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/sse.ts packages/sdk/tests/sse.test.ts
git commit -m "feat(core): add SSE frame parser"
```

---

### Task 2: Streaming HTTP method (`http.requestStream`)

**Files:**
- Modify: `packages/sdk/src/core/http.ts`
- Test: `packages/sdk/tests/http-stream.test.ts`

**Interfaces:**
- Consumes: `parseSseStream`, `SseEvent` from Task 1; existing `RequestOptions`, `resolveToken`, `errorFromResponse`, `EmporixNetworkError`, `EmporixTimeoutError`, private `buildHeaders`, private `safeJson`.
- Produces: `requestStream(o: RequestOptions): AsyncIterable<SseEvent>` on `HttpClient`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sdk/tests/http-stream.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { DefaultTokenProvider } from "../src/core/auth";
import { LevelResolver } from "../src/core/logger";
import { EmporixForbiddenError } from "../src/core/errors";
import { MemoryLogger } from "./helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  return new HttpClient({
    host: "https://api.emporix.io",
    provider: new DefaultTokenProvider(cfg),
    logger: new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "t" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
}

const URL = "https://api.emporix.io/stream";

describe("HttpClient.requestStream", () => {
  it("yields parsed SSE events from a text/event-stream body", async () => {
    server.use(
      http.post(URL, () => {
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("data: one\n\n"));
            c.enqueue(new TextEncoder().encode("data: two\n\n"));
            c.close();
          },
        });
        return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const events: string[] = [];
    for await (const e of client().requestStream({ method: "POST", path: "/stream", auth: { kind: "service" } })) {
      events.push(e.data);
    }
    expect(events).toEqual(["one", "two"]);
  });

  it("maps a non-2xx status to a typed error before streaming", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ message: "nope" }, { status: 403 })));
    await expect(async () => {
      for await (const _ of client().requestStream({ method: "POST", path: "/stream", auth: { kind: "service" } })) {
        /* unreachable */
      }
    }).rejects.toBeInstanceOf(EmporixForbiddenError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- tests/http-stream.test.ts`
Expected: FAIL — `requestStream is not a function`.

- [ ] **Step 3: Implement `requestStream`**

Add the import at the top of `packages/sdk/src/core/http.ts` (after the existing imports):

```typescript
import { parseSseStream, type SseEvent } from "./sse";
```

Add this method to the `HttpClient` class (after `requestRaw`, before the closing `}`):

```typescript
  /**
   * Open a Server-Sent Events stream (`text/event-stream`) and yield parsed
   * events. Unlike {@link request}, no overall read budget applies (streams are
   * long-lived) — only `connectMs` bounds time-to-headers, and the consumer
   * breaking the iterator aborts the fetch. Like {@link requestRaw}, it does
   * NOT retry or re-auth on 401; a non-2xx maps to a typed error before the
   * stream begins.
   */
  async *requestStream(o: RequestOptions): AsyncIterable<SseEvent> {
    const log = this.opts.logger.child({ requestId: `req-${++requestSeq}` });
    const url = new URL(this.opts.host + o.path);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const token = await resolveToken(o.auth, this.opts.provider);
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), this.opts.timeouts.connectMs);
    const headers = this.buildHeaders(o, token, false);
    headers["Accept"] = "text/event-stream";
    let res: Response;
    try {
      res = await fetch(url, {
        method: o.method,
        headers,
        signal: controller.signal,
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      });
    } catch (err) {
      clearTimeout(connectTimer);
      if ((err as Error).name === "AbortError") {
        throw new EmporixTimeoutError(`${o.method} ${o.path} timed out opening stream`);
      }
      throw new EmporixNetworkError(`${o.method} ${o.path} network failure: ${(err as Error).message}`);
    }
    clearTimeout(connectTimer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw errorFromResponse(res.status, `${o.method} ${o.path} → ${res.status}`, text ? safeJson(text) : undefined);
    }
    log.debug("http stream open", { status: res.status });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    async function* readChunks(): AsyncIterable<string> {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          yield decoder.decode(value, { stream: true });
        }
      } finally {
        controller.abort(); // cancel the fetch if the consumer breaks early
      }
    }
    yield* parseSseStream(readChunks());
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- tests/http-stream.test.ts`
Expected: PASS (2 tests). If `EmporixForbiddenError` is not the exact 403 error class, open `src/core/errors.ts`, confirm the class name mapped for 403, and use that class in the test.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/tests/http-stream.test.ts
git commit -m "feat(core): add requestStream for server-sent events"
```

---

### Task 3: `ai.chatStream` (SSE agent chat)

**Files:**
- Modify: `packages/sdk/src/services/ai.ts`, `packages/sdk/src/services/ai-types.ts`
- Test: `packages/sdk/tests/services/ai-stream.test.ts`

**Interfaces:**
- Consumes: `http.requestStream` (Task 2); existing `ChatRequest` type.
- Produces: `AiService.chatStream(input: ChatRequest, opts?: ChatStreamOptions, auth?: AuthContext): AsyncIterable<string>`; `interface ChatStreamOptions { sessionId?: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sdk/tests/services/ai-stream.test.ts
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
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "ai" });
  const http = new HttpClient({ host: "https://api.emporix.io", provider: tokenProvider, logger, retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 } });
  return new AiService({ tenant: "acme", http, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/ai-service/acme";

describe("AiService.chatStream", () => {
  it("streams SSE data chunks and forwards the session-id header", async () => {
    let seenSession: string | null = null;
    server.use(
      http.post(`${BASE}/agentic/chat-stream`, ({ request }) => {
        seenSession = request.headers.get("session-id");
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("data: chunk-1\n\n"));
            c.enqueue(new TextEncoder().encode("data: chunk-2\n\n"));
            c.close();
          },
        });
        return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const chunks: string[] = [];
    for await (const c of svc().chatStream({ agentId: "a", message: "hi" }, { sessionId: "sess-1" })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["chunk-1", "chunk-2"]);
    expect(seenSession).toBe("sess-1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/ai-stream.test.ts`
Expected: FAIL — `chatStream is not a function`.

- [ ] **Step 3: Implement `chatStream`**

In `packages/sdk/src/services/ai-types.ts`, add after the existing `DeleteAgentOptions`:

```typescript
/** Options for {@link AiService.chatStream}. */
export interface ChatStreamOptions {
  /**
   * Reuse an existing chat context (sent as the `session-id` header). If
   * omitted, the server generates a new session id.
   */
  sessionId?: string;
}
```

In `packages/sdk/src/services/ai.ts`, add `ChatStreamOptions` to both the `import type { … } from "./ai-types"` block and the `export type { … } from "./ai-types"` block, then add this method to the `AiService` class (after `chatAsync`):

```typescript
  /**
   * Streaming agent chat (`POST /agentic/chat-stream`, `text/event-stream`).
   * Yields each SSE `data` payload verbatim — the upstream contract types the
   * stream body as an opaque string, so chunks are raw strings, not parsed
   * objects. Consume with `for await`.
   */
  async *chatStream(
    input: ChatRequest,
    opts: ChatStreamOptions = {},
    auth: AuthContext = SERVICE,
  ): AsyncIterable<string> {
    const events = this.ctx.http.requestStream({
      method: "POST",
      path: `${this.base()}/agentic/chat-stream`,
      auth,
      body: input,
      ...(opts.sessionId ? { headers: { "session-id": opts.sessionId } } : {}),
    });
    for await (const ev of events) yield ev.data;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/ai-stream.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai.ts packages/sdk/src/services/ai-types.ts packages/sdk/tests/services/ai-stream.test.ts
git commit -m "feat(ai): add chatStream for streaming agent chat"
```

---

### Task 4: `ai.listConversations` + `ai.searchConversations`

**Files:**
- Modify: `packages/sdk/src/services/ai.ts`, `packages/sdk/src/services/ai-types.ts`
- Test: `packages/sdk/tests/services/ai-conversations.test.ts`

**Interfaces:**
- Consumes: existing `ctx.http.request`.
- Produces: `AiService.listConversations(auth?): Promise<Conversation[]>`, `AiService.searchConversations(query: ConversationSearchQuery, auth?): Promise<Conversation[]>`; types `Conversation`, `ConversationSearchQuery`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sdk/tests/services/ai-conversations.test.ts
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
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "ai" });
  const http = new HttpClient({ host: "https://api.emporix.io", provider: tokenProvider, logger, retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 } });
  return new AiService({ tenant: "acme", http, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/ai-service/acme";

describe("AiService conversations", () => {
  it("listConversations GETs the array", async () => {
    server.use(
      http.get(`${BASE}/agentic/conversations`, () =>
        HttpResponse.json([{ conversationId: "c1" }, { conversationId: "c2" }]),
      ),
    );
    const res = await svc().listConversations();
    expect(res.map((c) => c.conversationId)).toEqual(["c1", "c2"]);
  });

  it("searchConversations POSTs the query and returns the array", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/conversations/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ conversationId: "c9" }]);
      }),
    );
    const res = await svc().searchConversations({ q: "agentId:a" });
    expect(body).toEqual({ q: "agentId:a" });
    expect(res[0]?.conversationId).toBe("c9");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/ai-conversations.test.ts`
Expected: FAIL — `listConversations is not a function`.

- [ ] **Step 3: Implement the methods**

In `packages/sdk/src/services/ai-types.ts`, add the imports to the existing `import type { … } from "../generated/ai-service"` block:

```typescript
  ConversationResponse as GenConversation,
  QParamSearchBody2 as GenConversationSearchQuery,
```

Then add the exported types:

```typescript
/** A stored agentic conversation (Teams-backed). */
export type Conversation = GenConversation;
/** Request body for `searchConversations` (`{ q? }`) — same shape as agent search. */
export type ConversationSearchQuery = GenConversationSearchQuery;
```

In `packages/sdk/src/services/ai.ts`, add `Conversation` and `ConversationSearchQuery` to both the `import type { … }` and `export type { … }` blocks, then add these methods to the class (after `chatStream`):

```typescript
  /** List stored agentic conversations (`GET /agentic/conversations`). */
  async listConversations(auth: AuthContext = SERVICE): Promise<Conversation[]> {
    return this.ctx.http.request<Conversation[]>({
      method: "GET",
      path: `${this.base()}/agentic/conversations`,
      auth,
    });
  }

  /** Server-side conversation search (`POST /agentic/conversations/search`). */
  async searchConversations(
    query: ConversationSearchQuery,
    auth: AuthContext = SERVICE,
  ): Promise<Conversation[]> {
    return this.ctx.http.request<Conversation[]>({
      method: "POST",
      path: `${this.base()}/agentic/conversations/search`,
      auth,
      body: query,
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/ai-conversations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai.ts packages/sdk/src/services/ai-types.ts packages/sdk/tests/services/ai-conversations.test.ts
git commit -m "feat(ai): add listConversations and searchConversations"
```

---

### Task 5: `category.rebuildTree`

**Files:**
- Modify: `packages/sdk/src/services/category.ts`
- Test: `packages/sdk/tests/services/category-rebuild.test.ts`

**Interfaces:**
- Consumes: existing `ctx.http.request`, `CategoryNode` (= generated `CategoryTree`, already imported in `category.ts`).
- Produces: `CategoryService.rebuildTree(rootCategoryId: string, auth?: AuthContext): Promise<CategoryNode>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sdk/tests/services/category-rebuild.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CategoryService } from "../../src/services/category";
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
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "category" });
  const http = new HttpClient({ host: "https://api.emporix.io", provider: tokenProvider, logger, retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 } });
  return new CategoryService({ tenant: "acme", http, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/category/acme";

describe("CategoryService.rebuildTree", () => {
  it("POSTs to the rebuild endpoint with a service token and returns the tree", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post(`${BASE}/category-trees/root-1/rebuild`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ id: "root-1", nodes: [] });
      }),
    );
    const res = await svc().rebuildTree("root-1");
    expect(seenAuth).toBe("Bearer svc-tok");
    expect((res as { id?: string }).id).toBe("root-1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/category-rebuild.test.ts`
Expected: FAIL — `rebuildTree is not a function`.

- [ ] **Step 3: Implement `rebuildTree`**

In `packages/sdk/src/services/category.ts`, add a `SERVICE` const next to the existing `ANON` const:

```typescript
const SERVICE: AuthContext = { kind: "service" };
```

Add this method to the `CategoryService` class (after `tree()`):

```typescript
  /**
   * Rebuild a category tree from its root (`POST /category-trees/{rootCategoryId}/rebuild`).
   * Admin write — defaults to the service token. Returns the rebuilt tree.
   */
  async rebuildTree(rootCategoryId: string, auth: AuthContext = SERVICE): Promise<CategoryNode> {
    return this.ctx.http.request<CategoryNode>({
      method: "POST",
      path: `/category/${this.ctx.tenant}/category-trees/${encodeURIComponent(rootCategoryId)}/rebuild`,
      auth,
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/category-rebuild.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category-rebuild.test.ts
git commit -m "feat(category): add rebuildTree"
```

---

### Task 6: `schema.bulkPatchInstances`

**Files:**
- Modify: `packages/sdk/src/services/schema.ts`, `packages/sdk/src/services/schema-types.ts`
- Test: `packages/sdk/tests/services/schema-bulk.test.ts`

**Interfaces:**
- Consumes: existing `ctx.http.request`, private `instancesBase(type)`.
- Produces: `SchemaService.bulkPatchInstances(type: string, items: BulkPatchInstanceItem[], auth?: AuthContext): Promise<BulkInstanceResult>`; types `BulkPatchInstanceItem`, `BulkInstanceResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sdk/tests/services/schema-bulk.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SchemaService } from "../../src/services/schema";
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
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "schema" });
  const http = new HttpClient({ host: "https://api.emporix.io", provider: tokenProvider, logger, retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 } });
  return new SchemaService({ tenant: "acme", http, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/schema/acme";

describe("SchemaService.bulkPatchInstances", () => {
  it("PATCHes the items array and returns the 207 per-item results", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/custom-entities/car/instances/bulk`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          [{ index: 0, id: "Ford", code: 204, status: "No Content" }],
          { status: 207 },
        );
      }),
    );
    const res = await svc().bulkPatchInstances("car", [
      { id: "Ford", data: [{ op: "REPLACE", path: "/name/en", value: "Ford" }] },
    ]);
    expect(body).toEqual([{ id: "Ford", data: [{ op: "REPLACE", path: "/name/en", value: "Ford" }] }]);
    expect(res[0]?.code).toBe(204);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/schema-bulk.test.ts`
Expected: FAIL — `bulkPatchInstances is not a function`.

- [ ] **Step 3: Implement `bulkPatchInstances`**

In `packages/sdk/src/services/schema-types.ts`, add (following the existing generated re-export pattern in that file):

```typescript
import type {
  BulkPatchCustomInstanceRequest as GenBulkPatchInstanceItem,
  BulkResponse as GenBulkResponse,
} from "../generated/schema";

/** One item for {@link SchemaService.bulkPatchInstances} — `{ id, data: op[] }`. */
export type BulkPatchInstanceItem = GenBulkPatchInstanceItem;
/** Per-item results of a bulk operation (207) — `{ index?, code?, status?, message?, details? }[]`. */
export type BulkInstanceResult = GenBulkResponse;
```

In `packages/sdk/src/services/schema.ts`, add `BulkPatchInstanceItem` and `BulkInstanceResult` to both the `import type { … } from "./schema-types"` and `export type { … } from "./schema-types"` blocks, then add this method to the class (after `patchInstance`):

```typescript
  /**
   * Patch up to 200 custom instances of `type` in one call
   * (`PATCH /custom-entities/{type}/instances/bulk`). Returns a 207 envelope:
   * a per-item result array — a 207 is success, individual failures live in
   * each item's `code`/`status`.
   */
  async bulkPatchInstances(
    type: string,
    items: BulkPatchInstanceItem[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "PATCH",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: items,
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- tests/services/schema-bulk.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/schema.ts packages/sdk/src/services/schema-types.ts packages/sdk/tests/services/schema-bulk.test.ts
git commit -m "feat(schema): add bulkPatchInstances"
```

---

### Task 7: Deprecate the two wrapper methods

**Files:**
- Modify: `packages/sdk/src/services/indexing.ts`, `packages/sdk/src/services/ai-rag-indexer.ts`

**Interfaces:**
- No signature changes — JSDoc `@deprecated` only. Runtime behavior unchanged.

- [ ] **Step 1: (Confirmed) replacement for the RAG reindex**

The upstream deprecation note on `GET-ai-rag-indexer-reindex` reads: "This
endpoint is marked as deprecated. Use the *Creating reindex job* endpoint
instead" — i.e. the indexing-service reindex-jobs endpoint, exposed by the SDK
as `client.indexing.createReindexJob(...)`. Use that in the `@deprecated` tag.

- [ ] **Step 2: Add the `@deprecated` JSDoc to `indexing.reindex()`**

In `packages/sdk/src/services/indexing.ts`, replace the JSDoc/first line of `reindex` so it reads:

```typescript
  /**
   * Trigger a synchronous reindex (`POST /reindex`).
   *
   * @deprecated The upstream `POST /indexing/{tenant}/reindex` endpoint is
   * deprecated. Use {@link IndexingService.createReindexJob} instead.
   */
  async reindex(input: ReindexInput, auth: AuthContext = SERVICE): Promise<void> {
```

- [ ] **Step 3: Add the `@deprecated` JSDoc to `aiRagIndexer.reindex()`**

In `packages/sdk/src/services/ai-rag-indexer.ts`, add above the `reindex` method:

```typescript
  /**
   * Trigger a RAG reindex for the given type (`POST /{type}/reindex`).
   *
   * @deprecated The upstream RAG reindex endpoint is deprecated. Use the
   * indexing-service reindex job instead — `client.indexing.createReindexJob(...)`.
   */
```

- [ ] **Step 4: Verify types + existing tests still pass**

Run: `pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk test -- tests/services/indexing.test.ts tests/services/ai-rag-indexer.test.ts`
Expected: typecheck clean; existing indexing + rag-indexer tests PASS (JSDoc is non-behavioral).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/indexing.ts packages/sdk/src/services/ai-rag-indexer.ts
git commit -m "docs(sdk): mark deprecated reindex wrappers"
```

---

### Task 8: Changeset, docs, and full verification

**Files:**
- Create: `.changeset/emporix-api-facade-extensions.md`
- Modify: `docs/react.md` (or the most relevant existing SDK doc — add a short streaming/new-methods note)

**Interfaces:** none.

- [ ] **Step 1: Write the changeset**

```markdown
---
"@viu/emporix-sdk": minor
---

feat(sdk): expose new Emporix endpoints and add SSE streaming

- `ai.chatStream` (Server-Sent Events), `ai.listConversations`, `ai.searchConversations`
- `category.rebuildTree`
- `schema.bulkPatchInstances`
- New `HttpClient.requestStream` core capability for `text/event-stream`.
- Deprecated `indexing.reindex` and `aiRagIndexer.reindex` (JSDoc; upstream deprecation).
```

- [ ] **Step 2: Add a short docs note**

Append a "Streaming (SSE)" subsection to the AI section of the relevant doc, showing consumption:

```markdown
### AI: streaming agent chat

`client.ai.chatStream(input, { sessionId })` returns an async iterable of raw
SSE `data` strings:

\`\`\`ts
for await (const chunk of client.ai.chatStream({ agentId, message }, { sessionId })) {
  process.stdout.write(chunk);
}
\`\`\`

New non-streaming methods: `client.ai.listConversations()`,
`client.ai.searchConversations({ q })`, `client.category.rebuildTree(rootId)`,
`client.schema.bulkPatchInstances(type, items)`.
```

- [ ] **Step 3: Full verification (the whole gate)**

Run:
```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk lint
```
Expected: all pass. (Build react so the examples typecheck against fresh dist — see CLAUDE.md.)

- [ ] **Step 4: Commit**

```bash
git add .changeset/emporix-api-facade-extensions.md docs/
git commit -m "docs(sdk): add changeset and streaming docs for facade extensions"
```

---

## Notes for the implementer

- The `AiService` is server-side only (service token). `chatStream` inherits that; a storefront use would need a BFF (out of scope).
- `http.request` already treats a 207 as success (`res.ok`), so `bulkPatchInstances` returns the parsed body — do not special-case it.
- If a generated type name differs from what a task references (the sync may have renamed one), find the current name with `grep -n "export type" packages/sdk/src/generated/<service>/types.gen.ts` and update the import; do not hand-author the shape.
