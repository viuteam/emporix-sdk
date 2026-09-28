# AI Service

Bindings for the Emporix **AI Service** (`/ai-service/{tenant}/…`): text
generation, chat completions, and the full agentic layer — agent CRUD,
synchronous / asynchronous / streaming chat, the agent building blocks (tools,
MCP servers, tokens, OAuth configs), templates, jobs, logs, analytics, models,
commerce events, attachments, and agent export/import.

> **Server-side only.** Every endpoint requires a backend `ai.*` scope, served
> by the **service (clientCredentials) token**. Never construct these calls from
> a browser — the admin token must not be exposed. Use them in Node, Next.js
> route handlers / server actions, or other trusted backends.
>
> **Storefront chat?** A browser chat using the per-user
> `ai.agentexecution_manage_own` scope needs a **token-proxy** that holds the
> service credentials and brokers each `chat` call. For Next there is now a
> starting point: `@viu/emporix-sdk-next/service` for the credentials and
> `createEmporixPublicRoute` in `/session` as the shape to copy. There is still
> no React binding for the AI Service.
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

The read shape (`Agent`, returned by `listAgents` / `getAgent` / mutations) and
the write shape (`AgentInput`, accepted by `upsertAgent`) differ: a response
carries server-set fields (`id`, `type`, `metadata`, …) while an input requires
`triggers`, `llmConfig` and `mcpServers`. Build an `AgentInput` to create or
replace; treat the returned `Agent` as read-only.

```ts
const agents = await client.ai.listAgents();
const agent = await client.ai.getAgent("support-bot");

// create-or-replace (PUT) — pass the write shape
await client.ai.upsertAgent("support-bot", {
  name: { en: "Support bot" },
  triggers: [],
  llmConfig: { /* EmporixLlm | ApiKeyLlmRequest | SelfHostedLlmRequest */ },
  mcpServers: [],
});

// PATCH uses the UPPERCASE op enum (ADD | REMOVE | REPLACE), NOT lowercase JSON-Patch
await client.ai.patchAgent("support-bot", [{ op: "REPLACE", path: "/name", value: "Helpdesk" }]);

const found = await client.ai.searchAgents({ q: "support" });

// force is required if the agent is still referenced elsewhere
await client.ai.deleteAgent("support-bot", undefined, { force: true });
```

## Agentic chat

Both chat endpoints **return arrays** — the SDK preserves them verbatim.

```ts
// synchronous — ChatResponse[]
const replies = await client.ai.chat({ agentId: "support-bot", message: "Where is my order?" });
replies[0]?.message;

// continue the session: thread its id back as the second argument
await client.ai.chat(
  { agentId: "support-bot", message: "And when will it arrive?" },
  { sessionId: replies[0]?.sessionId! },
);

// asynchronous — JobIdResponse[] (HTTP 201)
const [{ jobId }] = await client.ai.chatAsync({ agentId: "support-bot", message: "…" });
```

All three chat methods take `(input, opts, auth)`: `opts.sessionId` is sent as
the `session-id` header — there is no `sessionId` field in the chat body — and
conversational memory also needs `enabledMemory` on the agent.

> **Changed in 4.0.0:** `chat` and `chatAsync` used to take `auth` second. It
> is third now, as on `chatStream`. A call that still passes an auth context
> second throws (`pass the auth context third`) rather than silently running on
> the service token: `chat(input, auth)` becomes `chat(input, {}, auth)`.

### Streaming (Server-Sent Events)

`chatStream` opens a `text/event-stream` and yields each SSE `data` payload
verbatim as a string (the upstream contract types the stream body as opaque, so
chunks are raw strings — parse them yourself if the agent emits JSON). Consume
with `for await`. Pass `sessionId` to continue an existing context (sent as the
`session-id` header; omit it and the server generates one).

```ts
for await (const chunk of client.ai.chatStream(
  { agentId: "support-bot", message: "Where is my order?" },
  { sessionId: "…" },
)) {
  process.stdout.write(chunk);
}
```

## Conversations

```ts
const all = await client.ai.listConversations();
const hits = await client.ai.searchConversations({ q: "agentId:support-bot" });
```

## Agent building blocks (`tools`, `mcpServers`, `tokens`, `oauths`)

Each is a uniform CRUD sub-resource: `list · search · get · upsert · patch · delete`.

```ts
const tools = await client.ai.tools.list();
const server = await client.ai.mcpServers.get("my-mcp");

// OAuth config + the token holding its client secret
const { id: tokenId } = (await client.ai.tokens.upsert("gh-secret", {
  name: "gh-secret",
  value: process.env.GH_SECRET!,
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

const { id: agentId } = await client.ai.templates.clone("support", {
  userPrompt: "Handle returns",
});

const errors = await client.ai.logs.searchSessions({ q: "severity:ERROR" });
const metrics = await client.ai.analytics.get({ agentId: "support" });
const exec = await client.ai.analytics.executions({
  agentIds: "support,sales",
  granularity: "WEEK",
});
```

## Models, commerce events, attachments, export/import

```ts
const models = await client.ai.listModels();
const events = await client.ai.listCommerceEvents();

const { id, sessionId } = await client.ai.uploadAttachment("bot", file); // file: Blob | File
// The session travels as the `session-id` header, the file as `attachments`.
for await (const chunk of client.ai.chatStream(
  { agentId: "bot", message: "See attachment", attachments: [{ attachmentId: id! }] },
  { sessionId: sessionId! },
)) {
  /* … */
}

// Hand the same file to a second agent instead of uploading it twice (200).
await client.ai.reuseAttachment("other-bot", id!, { sessionId: sessionId! });

// Without a session, the service opens one — use the id it returns.
const reused = await client.ai.reuseAttachment("other-bot", mediaAssetId);

const bundle = await client.ai.exportAgents({ agentIds: ["bot"] });
await client.ai.importAgents({ data: bundle.data, checksum: bundle.checksum });
```

The endpoint takes **exactly one** of the file or an `attachmentId` — both or
neither is a `400`, which is why these are two methods rather than one
overloaded call. `uploadAttachment` answers `201` with the new `{ id, sessionId }`,
`reuseAttachment` answers `200` with the same shape. `sessionId` is optional on
both: omit it and the service opens a session and returns its id. With the
`ai.agentexecution_manage` scope, `reuseAttachment` accepts any media asset id,
not only one uploaded to the session.

To chat about the file, the chat request must carry that `sessionId` as the
`session-id` **header** and list the file under `attachments`, addressed to the
same `agentId` the file was attached to — otherwise the service answers `400`.
All three chat methods send it from `opts.sessionId`, so `chat` and `chatAsync`
work exactly like the `chatStream` example above; the chat body has no
`sessionId` field.

> Until 2026-09-25 the reuse answered `204` with no body and required the
> `session-id` header. The SDK followed: `reuseAttachment` now resolves to the
> attachment instead of `undefined`, and `sessionId` is optional.

## Log and job fields that arrived with the spec

- Agent request and session logs carry `promptTokens` and `completionTokens`
  (per request, and rolled up per session).
- `handOff` on agent responses is **deprecated** and no longer used — ignore it.
- Upstream added cursor pagination (`next` / `prev` query parameters,
  `X-Next-Cursor` / `X-Prev-Cursor` response headers) to the log and job
  listings. **Not reachable through this SDK yet:** `logs.*` and `jobs.*` return
  plain arrays, so the cursor headers are dropped. Page with `pageNumber` /
  `pageSize`, which upstream still supports.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
(`deleteAgent`'s options object comes *after* `auth`:
`deleteAgent(id, auth, { force })`.)

## Out of scope

The facade now covers every `ai-service` operation. Note the AI Service API is
version `0.0.1` (unstable); shapes may change. There is no React binding — the
service is server-side only.
