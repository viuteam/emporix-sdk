import { type AuthContext, type TokenProvider, resolveToken } from "./auth";
import { errorFromResponse } from "./errors";
import type { Logger } from "./logger";

/** A single HTTP request through the SDK. */
export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: AuthContext;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Per-request abort timeout override (ms). */
  timeoutMs?: number;
}

/** Construction options for {@link HttpClient}. */
export interface HttpClientOptions {
  host: string;
  provider: TokenProvider;
  logger: Logger;
  retry: { maxAttempts: number };
  timeouts: { connectMs: number; readMs: number };
}

let requestSeq = 0;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Fetch wrapper: auth resolution, JSON parsing, typed error mapping, logging. */
export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async request<T = unknown>(o: RequestOptions): Promise<T> {
    const requestId = `req-${++requestSeq}`;
    const log = this.opts.logger.child({ requestId });
    const url = new URL(this.opts.host + o.path);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const token = await resolveToken(o.auth, this.opts.provider);
    log.debug("http request", {
      authKind: o.auth.kind,
      method: o.method,
      url: url.pathname,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? this.opts.timeouts.readMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: o.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      log.warn("http error", { authKind: o.auth.kind, status: res.status });
      throw errorFromResponse(res.status, `${o.method} ${o.path} → ${res.status}`, parsed);
    }
    log.debug("http ok", { status: res.status });
    return parsed as T;
  }
}
