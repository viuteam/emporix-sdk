import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import {
  AgenticCrudResource,
  JobsResource,
  TemplatesResource,
  LogsResource,
  AnalyticsResource,
} from "./ai-resources";
import { SEARCH_PAGING, splitQuery } from "../core/search";
import type {
  TextRequest,
  TextResponse,
  CompletionRequest,
  CompletionResponse,
  Agent,
  AgentInput,
  AgentPatchOp,
  AgentSearchQuery,
  ChatRequest,
  ChatResponse,
  JobIdResponse,
  DeleteAgentOptions,
  ChatOptions,
  Conversation,
  ConversationSearchQuery,
  Created,
  AgenticPatchOp,
  ListQuery,
  GetOptions,
  MutateOptions,
  SearchQuery,
  OAuthConfig,
  OAuthInput,
  Tool,
  ToolInput,
  Token,
  TokenInput,
  McpServer,
  McpServerInput,
  Job,
  AgentTemplate,
  AgentFromTemplate,
  AgentRequestLog,
  AgentSessionLog,
  AgentAnalytics,
  AgentExecutions,
  AnalyticsQuery,
  ExecutionsQuery,
  ProviderModels,
  CommerceEvents,
  Attachment,
  AttachmentOptions,
  AttachmentReuseOptions,
  AgentsExport,
  AgentsExportRequest,
  AgentsImport,
  AgentsImportRequest,
} from "./ai-types";

export type {
  TextRequest,
  TextResponse,
  CompletionMessage,
  CompletionRequest,
  CompletionResponse,
  Agent,
  AgentInput,
  AgentPatchOp,
  AgentSearchQuery,
  ChatRequest,
  ChatResponse,
  JobIdResponse,
  DeleteAgentOptions,
  ChatOptions,
  ChatStreamOptions,
  Conversation,
  ConversationSearchQuery,
  Created,
  AgenticPatchOp,
  ListQuery,
  GetOptions,
  MutateOptions,
  SearchPaging,
  SearchQuery,
  OAuthConfig,
  OAuthInput,
  Tool,
  ToolInput,
  Token,
  TokenInput,
  McpServer,
  McpServerInput,
  Job,
  AgentTemplate,
  AgentFromTemplate,
  AgentRequestLog,
  AgentSessionLog,
  AgentAnalytics,
  AgentExecutions,
  AnalyticsQuery,
  ExecutionsQuery,
  ProviderModels,
  CommerceEvents,
  Attachment,
  AttachmentOptions,
  AttachmentReuseOptions,
  AgentsExport,
  AgentsExportRequest,
  AgentsImport,
  AgentsImportRequest,
} from "./ai-types";

export type {
  AgenticCrudResource,
  AnalyticsResource,
  JobsResource,
  LogsResource,
  TemplatesResource,
} from "./ai-resources";

const SERVICE: AuthContext = { kind: "service" };

/**
 * `chat` and `chatAsync` took `auth` second until 4.0.0; now options come
 * second and `auth` third, as on `chatStream`. An old call would otherwise have
 * its auth context read as options and run on the default service token —
 * silently, in plain JavaScript — so it throws instead.
 */
function assertChatOptions(opts: ChatOptions, method: string): void {
  if (typeof opts === "object" && opts !== null && "kind" in opts) {
    throw new Error(
      `ai.${method}: the second argument is { sessionId? } since 4.0.0 — pass the auth context third`,
    );
  }
}

function sessionHeader(opts: ChatOptions): { headers?: Record<string, string> } {
  return opts.sessionId ? { headers: { "session-id": opts.sessionId } } : {};
}

const AUTH_KINDS = new Set(["service", "anonymous", "customer", "raw"]);

/**
 * `listAgents` and `listConversations` took only `auth` before they could page.
 * Tells that original call apart from `(query, auth)`, so an auth context is
 * never sent as query parameters — which would put a customer token in the URL.
 */
function isAuthContext(value: ListQuery | AuthContext): value is AuthContext {
  return AUTH_KINDS.has(String((value as { kind?: unknown }).kind));
}

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
  static readonly channel = "ai" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/ai-service/${this.ctx.tenant}`;
  }

  // --- Agentic building blocks (CRUD sub-resources) ----------------------

  private _oauths?: AgenticCrudResource<OAuthConfig, OAuthInput>;
  /** OAuth 2.0 client-credentials configs (`/agentic/oauths`). CRUD sub-resource. */
  get oauths(): AgenticCrudResource<OAuthConfig, OAuthInput> {
    return (this._oauths ??= new AgenticCrudResource(this.ctx, `${this.base()}/agentic/oauths`));
  }

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

  private _jobs?: JobsResource;
  /** AI async jobs (`/jobs`). `list · search · get · delete`. */
  get jobs(): JobsResource {
    return (this._jobs ??= new JobsResource(this.ctx, this.base()));
  }

  private _templates?: TemplatesResource;
  /** Agent templates (`/agentic/templates`). `list · search · clone`. */
  get templates(): TemplatesResource {
    return (this._templates ??= new TemplatesResource(this.ctx, `${this.base()}/agentic/templates`));
  }

  private _logs?: LogsResource;
  /** Agent logs (`/agentic/logs`): request + session logs. */
  get logs(): LogsResource {
    return (this._logs ??= new LogsResource(this.ctx, `${this.base()}/agentic/logs`));
  }

  private _analytics?: AnalyticsResource;
  /** Agent analytics (`/agentic/analytics`). `get · executions`. */
  get analytics(): AnalyticsResource {
    return (this._analytics ??= new AnalyticsResource(this.ctx, `${this.base()}/agentic/analytics`));
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

  /**
   * List agents (`GET /agentic/agents`). `q`, `pageNumber`, `pageSize`, `sort`,
   * `fields` and `expand` go in the query string; without paging keys the
   * server returns its first page. The original `listAgents(auth)` still works.
   */
  listAgents(auth?: AuthContext): Promise<Agent[]>;
  listAgents(query: ListQuery, auth?: AuthContext): Promise<Agent[]>;
  async listAgents(queryOrAuth: ListQuery | AuthContext = {}, auth: AuthContext = SERVICE): Promise<Agent[]> {
    const [query, ctx]: [ListQuery, AuthContext] = isAuthContext(queryOrAuth)
      ? [{}, queryOrAuth]
      : [queryOrAuth, auth];
    return this.ctx.http.request<Agent[]>({
      method: "GET",
      path: `${this.base()}/agentic/agents`,
      auth: ctx,
      query: { ...query },
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

  /** Create-or-replace an agent by id (`PUT`). Takes the agent write shape. */
  async upsertAgent(id: string, agent: AgentInput, auth: AuthContext = SERVICE): Promise<Agent> {
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
      ...(opts.force ? { query: { force: "true" } } : {}),
    });
  }

  /**
   * Server-side agent search (`POST /agentic/agents/search`). `q` goes in the
   * body; `pageNumber`, `pageSize`, `sort` and `fields` in the query string.
   */
  async searchAgents(query: AgentSearchQuery, auth: AuthContext = SERVICE): Promise<Agent[]> {
    return this.ctx.http.request<Agent[]>({
      method: "POST",
      path: `${this.base()}/agentic/agents/search`,
      auth,
      ...splitQuery(query, SEARCH_PAGING),
    });
  }

  /**
   * Synchronous agent chat (`POST /agentic/chat`). Returns the response
   * ARRAY verbatim (the upstream contract is an array, not a single object).
   *
   * `opts.sessionId` is sent as the `session-id` header. It carries the
   * conversation — continuity needs it plus `enabledMemory` on the agent — and
   * it is how a chat reaches an attachment: pass the `sessionId` the upload or
   * reuse returned, and list the file under `input.attachments`.
   */
  async chat(
    input: ChatRequest,
    opts: ChatOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ChatResponse[]> {
    assertChatOptions(opts, "chat");
    return this.ctx.http.request<ChatResponse[]>({
      method: "POST",
      path: `${this.base()}/agentic/chat`,
      auth,
      body: input,
      ...sessionHeader(opts),
    });
  }

  /**
   * Fire-and-forget agent chat (`POST /agentic/chat-async`, HTTP 201).
   * Returns the job-id ARRAY verbatim. `opts` as for {@link chat}.
   */
  async chatAsync(
    input: ChatRequest,
    opts: ChatOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<JobIdResponse[]> {
    assertChatOptions(opts, "chatAsync");
    return this.ctx.http.request<JobIdResponse[]>({
      method: "POST",
      path: `${this.base()}/agentic/chat-async`,
      auth,
      body: input,
      ...sessionHeader(opts),
    });
  }

  /**
   * Streaming agent chat (`POST /agentic/chat-stream`, `text/event-stream`).
   * Yields each SSE `data` payload verbatim — the upstream contract types the
   * stream body as an opaque string, so chunks are raw strings, not parsed
   * objects. Consume with `for await`. `opts` as for {@link chat}.
   */
  async *chatStream(
    input: ChatRequest,
    opts: ChatOptions = {},
    auth: AuthContext = SERVICE,
  ): AsyncIterable<string> {
    assertChatOptions(opts, "chatStream");
    const events = this.ctx.http.requestStream({
      method: "POST",
      path: `${this.base()}/agentic/chat-stream`,
      auth,
      body: input,
      ...sessionHeader(opts),
    });
    for await (const ev of events) yield ev.data;
  }

  /**
   * List stored agentic conversations (`GET /agentic/conversations`), paged
   * like {@link listAgents}. The original `listConversations(auth)` still works.
   */
  listConversations(auth?: AuthContext): Promise<Conversation[]>;
  listConversations(query: ListQuery, auth?: AuthContext): Promise<Conversation[]>;
  async listConversations(
    queryOrAuth: ListQuery | AuthContext = {},
    auth: AuthContext = SERVICE,
  ): Promise<Conversation[]> {
    const [query, ctx]: [ListQuery, AuthContext] = isAuthContext(queryOrAuth)
      ? [{}, queryOrAuth]
      : [queryOrAuth, auth];
    return this.ctx.http.request<Conversation[]>({
      method: "GET",
      path: `${this.base()}/agentic/conversations`,
      auth: ctx,
      query: { ...query },
    });
  }

  /** Server-side conversation search (`POST /agentic/conversations/search`), paged like {@link searchAgents}. */
  async searchConversations(
    query: ConversationSearchQuery,
    auth: AuthContext = SERVICE,
  ): Promise<Conversation[]> {
    return this.ctx.http.request<Conversation[]>({
      method: "POST",
      path: `${this.base()}/agentic/conversations/search`,
      auth,
      ...splitQuery(query, SEARCH_PAGING),
    });
  }

  // --- Standalone agentic reads / bulk operations ------------------------

  /** List models available to the tenant, grouped by provider (`GET /agentic/models`). */
  async listModels(auth: AuthContext = SERVICE): Promise<ProviderModels[]> {
    return this.ctx.http.request<ProviderModels[]>({
      method: "GET",
      path: `${this.base()}/agentic/models`,
      auth,
    });
  }

  /** List commerce events available to agent triggers (`GET /agentic/commerce-events`). */
  async listCommerceEvents(auth: AuthContext = SERVICE): Promise<CommerceEvents> {
    return this.ctx.http.request<CommerceEvents>({
      method: "GET",
      path: `${this.base()}/agentic/commerce-events`,
      auth,
    });
  }

  /**
   * Upload a chat attachment for an agent
   * (`POST /agentic/{agentId}/attachments`, multipart, HTTP 201). The response
   * `sessionId` must be threaded into subsequent chat calls to bind the file.
   * Pass `opts.sessionId` to attach to an existing session.
   *
   * The endpoint takes exactly one of `attachment` or `attachmentId` — both or
   * neither is a `400`. This method always sends the file; to point a second
   * agent at a file already in the session, use {@link reuseAttachment}.
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

  /**
   * Assign an existing media asset to an agent as a chat attachment
   * (`POST /agentic/{agentId}/attachments` with the `attachmentId` form field,
   * HTTP 200). Resolves to the attachment `id` and the `sessionId` to send on
   * the following chat calls.
   *
   * Use it to hand a second agent the same file instead of uploading it twice.
   * Pass `opts.sessionId` to attach to an existing chat session; without it the
   * service opens a new one and returns its id — thread that into the chat, or
   * the agent never sees the file. With `ai.agentexecution_manage` the asset may
   * be any media asset, not only one uploaded to this session.
   *
   * ```ts
   * const { id, sessionId } = await client.ai.uploadAttachment("agent-a", file);
   * await client.ai.reuseAttachment("agent-b", id!, { sessionId: sessionId! });
   * ```
   */
  async reuseAttachment(
    agentId: string,
    attachmentId: string,
    opts: AttachmentReuseOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<Attachment> {
    const form = new FormData();
    form.append("attachmentId", attachmentId);
    return this.ctx.http.request<Attachment>({
      method: "POST",
      path: `${this.base()}/agentic/${encodeURIComponent(agentId)}/attachments`,
      auth,
      body: form,
      ...(opts.sessionId ? { headers: { "session-id": opts.sessionId } } : {}),
    });
  }

  /** Export agents + components as a base64/checksum blob (`POST /agentic/agents/export`). */
  async exportAgents(body: AgentsExportRequest, auth: AuthContext = SERVICE): Promise<AgentsExport> {
    return this.ctx.http.request<AgentsExport>({
      method: "POST",
      path: `${this.base()}/agentic/agents/export`,
      auth,
      body,
    });
  }

  /** Import previously-exported agents (`POST /agentic/agents/import`). */
  async importAgents(body: AgentsImportRequest, auth: AuthContext = SERVICE): Promise<AgentsImport> {
    return this.ctx.http.request<AgentsImport>({
      method: "POST",
      path: `${this.base()}/agentic/agents/import`,
      auth,
      body,
    });
  }
}
