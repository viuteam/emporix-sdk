import type {
  TextGenerationRequest as GenTextRequest,
  CompletionRequest as GenCompletionRequest,
  AgentResponse as GenAgent,
  AgentRequest as GenAgentInput,
  PatchRequest as GenPatchRequest,
  QParamSearchBody as GenAgentSearchQuery,
  AgenticRequest as GenChatRequest,
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
