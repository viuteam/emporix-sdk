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
