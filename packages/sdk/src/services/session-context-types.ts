import type {
  SessionContextGet,
  SessionContextPatch as GenSessionContextPatch,
  Context,
} from "../generated/session-context";

/** Custom session-context attributes — a nested key → (key → value) map. */
export type SessionContextData = Context;

/**
 * The current session context (`GET /me/context`). Mirrors the generated
 * `SessionContextGet` but re-tightens `sessionId` to required — a returned
 * context always carries one.
 */
export type SessionContext = Omit<SessionContextGet, "sessionId"> & {
  sessionId: string;
};

/**
 * Input for {@link SessionContextService.patch}. The updatable fields are
 * derived from the generated patch body; `version` is a flat convenience for
 * the wire's `metadata.version` (the service maps it). Omit `version` to have
 * the service resolve it via a GET first.
 */
export type SessionContextPatch = Pick<
  GenSessionContextPatch,
  "siteCode" | "currency" | "targetLocation" | "language" | "context"
> & {
  /** Optimistic-locking version. If omitted, resolved via GET. */
  version?: number;
};
