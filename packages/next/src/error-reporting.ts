import { redact } from "@viu/emporix-sdk";

/**
 * Closed set of failure points this package reports. A stable, greppable
 * identifier rather than a message: the SDK's error messages interpolate tenant
 * and path, so a consumer fingerprinting on the message gets one bucket per
 * request. Group on `code`, read the detail from `cause`.
 */
export type EmporixErrorCode =
  | "session.store.read_failed"
  | "session.flush_failed"
  | "session.cart_onboarding_failed"
  | "session.cookie_undecryptable"
  | "session.anonymous_cookie_unparseable"
  | "session.logout_upstream_failed"
  | "webhook.handler_failed"
  | "webhook.body_unparseable";

export interface EmporixErrorEvent {
  readonly code: EmporixErrorCode;
  /**
   * What the package did as a result — the caller-visible consequence. «Store
   * read failed» is half a signal; what matters on call is that the request
   * then continued as a logged-out visitor.
   */
  readonly degradedTo: string;
  readonly severity: "warning" | "error";
  /**
   * The caught value, unchanged and **not** redacted: a scrubbed stack trace is
   * useless. It may contain whatever the thrower put in it — scrubbing `cause`
   * is the consumer's decision, not this package's.
   */
  readonly cause: unknown;
  /** Primitives only, already through `redact()`. Never holds a token. */
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export type EmporixErrorReporter = (event: EmporixErrorEvent) => void;

interface ReportInput {
  code: EmporixErrorCode;
  degradedTo: string;
  cause: unknown;
  severity?: "warning" | "error";
  context?: Record<string, string | number | boolean>;
}

let reporter: EmporixErrorReporter | null = null;

/**
 * Registers the process-wide error reporter. Call it once from Next's
 * `instrumentation.ts`, whose `register()` runs before the first request.
 *
 * Module scope rather than a `getEmporixClient` option on purpose: that factory
 * is memoized on a string key, and a function cannot go in a string key — so a
 * per-client reporter would mean the first caller silently wins for the whole
 * process.
 *
 * The package ships no implementation. Pass `null` to unregister.
 */
export function setEmporixErrorReporter(next: EmporixErrorReporter | null): void {
  reporter = next;
}

/**
 * Internal. Reports and returns — never throws, never yields a value a caller
 * has to handle, so it is safe to call from inside a `catch` without adding a
 * second failure mode. Synchronous by design: a reporter that wants I/O queues
 * it itself rather than putting the request's critical path behind a network hop.
 */
export function reportEmporixError(input: ReportInput): void {
  const r = reporter;
  if (r === null) return;
  try {
    r({
      code: input.code,
      degradedTo: input.degradedTo,
      severity: input.severity ?? "error",
      cause: input.cause,
      context: redact(input.context ?? {}) as Readonly<
        Record<string, string | number | boolean>
      >,
    });
  } catch {
    // A broken reporter must not become the failure it was meant to report.
  }
}

/** Test-only: clears the registration so each test starts clean. */
export function __resetEmporixErrorReporter(): void {
  reporter = null;
}
