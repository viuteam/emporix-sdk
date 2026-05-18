/** Keys whose values are stripped from any serialised error body. */
const REDACTED_BODY_KEYS = new Set([
  "access_token", "refresh_token", "token", "customertoken", "saastoken",
  "secret", "client_secret", "authorization", "password",
]);

function scrub(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(scrub);
  if (body && typeof body === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      out[k] = REDACTED_BODY_KEYS.has(k.toLowerCase()) ? "***redacted***" : scrub(v);
    }
    return out;
  }
  return body;
}

/** Base class for every error thrown by the SDK. */
export class EmporixError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  /** Safe serialisation — token-like body fields are redacted. */
  toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message, status: this.status, body: scrub(this.body) };
  }
}

/** 401 — authentication failed or token expired. */
export class EmporixAuthError extends EmporixError {}
/** 403 — authenticated but not permitted. */
export class EmporixForbiddenError extends EmporixError {}
/** 404 — resource not found. */
export class EmporixNotFoundError extends EmporixError {}
/** 400/422 — request validation failed. */
export class EmporixValidationError extends EmporixError {}
/** 5xx — server-side failure. */
export class EmporixServerError extends EmporixError {}

/** Maps an HTTP status to the matching {@link EmporixError} subclass. */
export function errorFromResponse(status: number, message: string, body: unknown): EmporixError {
  if (status === 401) return new EmporixAuthError(message, status, body);
  if (status === 403) return new EmporixForbiddenError(message, status, body);
  if (status === 404) return new EmporixNotFoundError(message, status, body);
  if (status === 400 || status === 422) return new EmporixValidationError(message, status, body);
  if (status >= 500) return new EmporixServerError(message, status, body);
  return new EmporixError(message, status, body);
}
