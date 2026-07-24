import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type { SessionContext, SessionContextPatch } from "./session-context-types";

export type {
  SessionContext,
  SessionContextPatch,
  SessionContextData,
} from "./session-context-types";

const ANON: AuthContext = auth.anonymous();

/**
 * Session-context binding for the current storefront session. Both endpoints
 * resolve the session-id from the `Authorization` token — no path/query
 * parameter required.
 */
export class SessionContextService {
  static readonly channel = "session-context" as const;
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Retrieves the current session context, or `null` when the server returns
   * 404 (no session exists yet — the session-context is created server-side
   * only after the user creates a cart).
   */
  async get(authCtx: AuthContext = ANON): Promise<SessionContext | null> {
    try {
      return await this.ctx.http.request<SessionContext>({
        method: "GET",
        path: `/session-context/${this.ctx.tenant}/me/context`,
        auth: authCtx,
      });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Partially updates the current session context. Returns `true` when the
   * PATCH was applied, `false` when there is no session context yet (the
   * server returned 404 on the version-lookup GET, so there is nothing to
   * update). Non-404 errors propagate.
   */
  async patch(input: SessionContextPatch, authCtx: AuthContext = ANON): Promise<boolean> {
    let version = input.version;
    if (version === undefined) {
      const current = await this.get(authCtx);
      if (current === null) return false;
      version = current.metadata?.version;
      if (version === undefined) {
        throw new Error(
          "SessionContextService.patch: no metadata.version in server response",
        );
      }
    }
    const { version: _v, ...fields } = input;
    void _v;
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `/session-context/${this.ctx.tenant}/me/context`,
      body: {
        ...fields,
        metadata: { version },
      },
      auth: authCtx,
    });
    return true;
  }
}

function isNotFound(err: unknown): boolean {
  if (err && typeof err === "object") {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status === 404) return true;
  }
  return false;
}
