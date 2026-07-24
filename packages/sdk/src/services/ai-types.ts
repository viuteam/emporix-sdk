import type {
  TextGenerationRequest as GenTextRequest,
  CompletionRequest as GenCompletionRequest,
  AgentResponse as GenAgent,
  AgentRequest as GenAgentInput,
  PatchRequest as GenPatchRequest,
  QParamSearchBody as GenAgentSearchQuery,
  AgenticRequest as GenChatRequest,
  ConversationResponse as GenConversation,
  QParamSearchBody2 as GenConversationSearchQuery,
  IdResponse as GenIdResponse,
  OAuthResponse as GenOAuthResponse,
  OauthUpsertBody as GenOAuthInput,
  NativeToolsResponse as GenNativeTools,
  ToolUpsertBody as GenToolInput,
  TokenResponse as GenToken,
  TokenUpsertBody as GenTokenInput,
  McpServerResponse as GenMcpServer,
  McpServerUpsertBody as GenMcpServerInput,
  Job as GenJob,
  AgentTemplateResponse as GenAgentTemplate,
  AgentFromTemplateRequest as GenAgentFromTemplate,
  AgentRequestResponse as GenAgentRequestLog,
  AgentSessionResponse as GenAgentSessionLog,
  AgentAnalyticsResponse as GenAgentAnalytics,
  ExecutionsResponse as GenAgentExecutions,
  ProviderModelsResponse as GenProviderModels,
  CommerceEventsResponse as GenCommerceEvents,
  AttachmentResponse as GenAttachment,
  ExportResponse as GenAgentsExport,
  ExportRequest as GenAgentsExportRequest,
  ImportResponse as GenAgentsImport,
  ImportRequest as GenAgentsImportRequest,
} from "../generated/ai-service";

/** Single-shot text generation request (`POST /texts`). Has `maxTokens`. */
export type TextRequest = GenTextRequest;
/**
 * Text generation response — `{ id?, result }`. The upstream schema marks
 * `result` optional, but a 2xx text generation always returns it; the public
 * contract guarantees `result` so callers need not null-check.
 */
export interface TextResponse {
  id?: string;
  result: string;
}

/** One message in a completion request. `role` ∈ `USER | SYSTEM | ASSISTANT`. */
export type CompletionMessage = GenCompletionRequest["messages"][number];
/** Chat completion request (`POST /completions`). No `maxTokens` (server-fixed model). */
export type CompletionRequest = GenCompletionRequest;
/** Chat completion response — `{ id?, result }` (shares the text generation shape). */
export interface CompletionResponse {
  id?: string;
  result: string;
}

/** An agentic agent definition (the read/response shape, returned by every agent method). */
export type Agent = GenAgent;
/** The write shape for {@link AiService.upsertAgent} (`PUT /agentic/agents/{id}`). */
export type AgentInput = GenAgentInput;
/**
 * One PATCH operation for `patchAgent`. `op` is the upstream UPPERCASE enum
 * (`ADD | REMOVE | REPLACE`) — NOT RFC-6902 lowercase. Passed verbatim.
 */
export type AgentPatchOp = GenPatchRequest[number];
/** Request body for `POST /agentic/agents/search` (`{ q? }`). */
export type AgentSearchQuery = GenAgentSearchQuery;

/** Request body for `chat` / `chatAsync` — `{ agentId, message }`. */
export type ChatRequest = GenChatRequest;
/**
 * One synchronous chat result — `{ agentId, agentType, sessionId, message }`.
 * The upstream schema marks every field optional and types `agentType` as an
 * enum; the public contract surfaces the fields a successful chat always
 * returns as required strings.
 */
export interface ChatResponse {
  agentId: string;
  agentType: string;
  sessionId: string;
  message: string;
}
/** One async job acknowledgement — `{ jobId }`. */
export interface JobIdResponse {
  jobId: string;
}

/** Options for {@link AiService.deleteAgent}. */
export interface DeleteAgentOptions {
  /** Force deletion even if the agent is referenced elsewhere (`?force=true`). */
  force?: boolean;
}

/** Options for {@link AiService.chatStream}. */
export interface ChatStreamOptions {
  /**
   * Reuse an existing chat context (sent as the `session-id` header). If
   * omitted, the server generates a new session id.
   */
  sessionId?: string;
}

/** A stored agentic conversation (Teams-backed). */
export type Conversation = GenConversation;
/** Request body for `searchConversations` (`{ q? }`) — same shape as agent search. */
export type ConversationSearchQuery = GenConversationSearchQuery;

// --- Agentic building blocks (CRUD sub-resources) --------------------------

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

/** An async AI job (`IMPORT` / `EXPORT` / `AGENT_CHAT`) with status + result. */
export type Job = GenJob;

/** An available agent template. */
export type AgentTemplate = GenAgentTemplate;
/** Body for {@link AiService.templates}`.clone` — the user prompt + overrides. */
export type AgentFromTemplate = GenAgentFromTemplate;

/** One agent request-log entry. */
export type AgentRequestLog = GenAgentRequestLog;
/** One agent session-log entry. */
export type AgentSessionLog = GenAgentSessionLog;

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

/** Models available to the tenant, grouped by LLM provider. */
export type ProviderModels = GenProviderModels;
/** The set of commerce events an agent trigger can subscribe to. */
export type CommerceEvents = GenCommerceEvents;

/** Result of an attachment upload — `{ id?, sessionId? }`. */
export type Attachment = GenAttachment;

/** Options for {@link AiService.uploadAttachment}. */
export interface AttachmentOptions {
  /**
   * Reuse a chat context — sent as the `session-id` header. Thread the
   * returned `sessionId` into chat calls to bind the file.
   */
  sessionId?: string;
}

/** Base64+checksum export of agents with their components. */
export type AgentsExport = GenAgentsExport;
/** Body for {@link AiService.exportAgents} — `{ agentIds }`. */
export type AgentsExportRequest = GenAgentsExportRequest;
/** Result of an agents import. */
export type AgentsImport = GenAgentsImport;
/** Body for {@link AiService.importAgents} — `{ data, checksum }`. */
export type AgentsImportRequest = GenAgentsImportRequest;
