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
replies[0]?.sessionId; // continue a session by threading this back

// asynchronous — JobIdResponse[] (HTTP 201)
const [{ jobId }] = await client.ai.chatAsync({ agentId: "support-bot", message: "…" });
```

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

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
(`deleteAgent`'s options object comes *after* `auth`:
`deleteAgent(id, auth, { force })`.)

## Out of scope

Templates, import/export, logs/sessions, and tokens endpoints are not yet bound.
The AI Service API is version `0.0.1` (unstable); shapes may change.
