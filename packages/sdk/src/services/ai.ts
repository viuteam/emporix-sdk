import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import {
  AgenticCrudResource,
  JobsResource,
  TemplatesResource,
  LogsResource,
  AnalyticsResource,
} from "./ai-resources";
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
  ChatStreamOptions,
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
  ChatStreamOptions,
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
  AgentsExport,
  AgentsExportRequest,
  AgentsImport,
  AgentsImportRequest,
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
