import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type {
  SessionContext,
  SessionContextPatch,
  SessionAttributeInput,
} from "./session-context-types";

export type {
  SessionContext,
  SessionContextPatch,
  SessionContextData,
  SessionAttributeInput,
} from "./session-context-types";

const ANON: AuthContext = auth.anonymous();

/**
 * Session-context binding for the current storefront session. Every method here
 * hits a `/me/context` path, so the session-id comes from the `Authorization`
 * token — no path or query parameter required.
 *
 * **The service's other half is intentionally not wrapped.** Emporix also exposes
 * the same four operations addressed by an explicit session id —
 * `GET`/`PUT /{sessionId}/context`, `POST`/`DELETE` on its attributes. Those are
 * administrative: they let a caller read and rewrite *someone else's* session,
 * which is not a storefront capability and needs a service token. Wrapping them
 * here would put an admin surface on the object a storefront holds. If you need
 * them, build the request directly — the generated types are in
 * `../generated/session-context`.
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

  /** Adds an attribute to the current session context. Default auth: anonymous. */
  async addAttribute(
    attribute: SessionAttributeInput,
    authCtx: AuthContext = ANON,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `/session-context/${this.ctx.tenant}/me/context/attributes`,
      body: attribute,
      auth: authCtx,
    });
  }

  /** Removes a named attribute from the current session context. Default auth: anonymous. */
  async removeAttribute(name: string, authCtx: AuthContext = ANON): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/session-context/${this.ctx.tenant}/me/context/attributes/${encodeURIComponent(name)}`,
      auth: authCtx,
    });
  }
}

function isNotFound(err: unknown): boolean {
  if (err && typeof err === "object") {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status === 404) return true;
  }
  return false;
}
