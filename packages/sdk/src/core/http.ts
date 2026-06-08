import {
  type AuthContext,
  type TokenProvider,
  type CustomerRefreshRegistry,
  resolveToken,
} from "./auth";
import { errorFromResponse } from "./errors";
import type { Logger } from "./logger";

/** A single HTTP request through the SDK. */
export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: AuthContext;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Extra request headers (merged before auth; cannot override Authorization). */
  headers?: Record<string, string>;
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
  /** Override the retry backoff delay (ms → Promise). Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Opt-in customer-token refresher registry (off unless a refresher is set). */
  customerRefresh?: CustomerRefreshRegistry;
  /**
   * Shared storefront request context. When `language` is set, every request
   * carries `Accept-Language: <language>`. Mutated at runtime via
   * `EmporixClient.setStorefrontContext({ language })`.
   */
  requestContext?: { language?: string | undefined };
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
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private readonly opts: HttpClientOptions) {
    this.sleep =
      opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  private buildHeaders(
    o: RequestOptions,
    token: string,
    isFormData: boolean,
  ): Record<string, string> {
    return {
      ...(this.opts.requestContext?.language
        ? { "Accept-Language": this.opts.requestContext.language }
        : {}),
      ...(o.headers ?? {}),
      Authorization: `Bearer ${token}`,
      // JSON bodies: set Content-Type. FormData bodies: let `fetch`
      // emit `multipart/form-data; boundary=...` itself.
      ...(o.body !== undefined && !isFormData
        ? { "Content-Type": "application/json" }
        : {}),
    };
  }

  async request<T = unknown>(o: RequestOptions): Promise<T> {
    const requestId = `req-${++requestSeq}`;
    const log = this.opts.logger.child({ requestId });
    const url = new URL(this.opts.host + o.path);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const sdkManaged = o.auth.kind === "service" || o.auth.kind === "anonymous";
    const maxAttempts = this.opts.retry.maxAttempts;
    let reauthed = false;
    let customerToken = o.auth.kind === "customer" ? o.auth.token : undefined;
    let customerReauthed = false;

    for (let attempt = 1; ; attempt++) {
      const token = customerToken ?? (await resolveToken(o.auth, this.opts.provider));
      log.debug("http request", {
        authKind: o.auth.kind,
        method: o.method,
        url: url.pathname,
        attempt,
      });

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        o.timeoutMs ?? this.opts.timeouts.readMs,
      );
      const isFormData =
        typeof FormData !== "undefined" && o.body instanceof FormData;
      const init: RequestInit = {
        method: o.method,
        headers: this.buildHeaders(o, token, isFormData),
        signal: controller.signal,
      };
      if (o.body !== undefined) {
        init.body = isFormData ? (o.body as FormData) : JSON.stringify(o.body);
      }
      let res: Response;
      try {
        res = await fetch(url, init);
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;
      if (res.ok) {
        log.debug("http ok", { status: res.status });
        return parsed as T;
      }

      // 401 asymmetry.
      if (res.status === 401) {
        if (sdkManaged && !reauthed) {
          reauthed = true;
          if (o.auth.kind === "service") {
            this.opts.provider.invalidate?.(o.auth.credentials ?? "backend");
          } else if (this.opts.provider.expireAnonymous) {
            // Keep the refresh token so the retry refreshes (same sessionId)
            // instead of starting a new anonymous session.
            this.opts.provider.expireAnonymous();
          } else {
            this.opts.provider.invalidateAnonymous?.();
          }
          log.warn("sdk-managed 401, re-authing once", { authKind: o.auth.kind });
          continue;
        }
        if (
          o.auth.kind === "customer" &&
          !customerReauthed &&
          this.opts.customerRefresh?.enabled
        ) {
          customerReauthed = true;
          const fresh = await this.opts.customerRefresh.refresh(customerToken!);
          if (fresh) {
            customerToken = fresh;
            log.warn("customer 401, refreshed once", { authKind: o.auth.kind });
            continue;
          }
        }
        throw errorFromResponse(res.status, `${o.method} ${o.path} → 401`, parsed);
      }

      // Retry 5xx / 429.
      const retryable = res.status >= 500 || res.status === 429;
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter >= 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 100;
        log.warn("retryable failure", { status: res.status, attempt, backoffMs: backoff });
        await this.sleep(backoff);
        continue;
      }

      log.error("http error (final)", { status: res.status, attempt });
      throw errorFromResponse(res.status, `${o.method} ${o.path} → ${res.status}`, parsed);
    }
  }

  /**
   * Single-shot fetch that returns the raw {@link Response} unparsed. Used by
   * endpoints whose responses are not JSON (binary downloads, redirect-only
   * endpoints). Skips the retry-on-5xx and 401-reauth-once paths intentionally
   * — those depend on parsing the JSON error body, which a raw consumer must
   * handle itself if needed. Auth resolution + timeout + logging are still
   * applied.
   *
   * `extra.redirect` is forwarded to `fetch` so callers can use `'manual'` to
   * capture 30x responses with their `Location` header (Node fetch exposes
   * the header in this mode; browser fetch returns an opaque response).
   */
  async requestRaw(
    o: RequestOptions,
    extra?: { redirect?: "follow" | "manual" | "error" },
  ): Promise<Response> {
    const requestId = `req-${++requestSeq}`;
    const log = this.opts.logger.child({ requestId });
    const url = new URL(this.opts.host + o.path);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const token = await resolveToken(o.auth, this.opts.provider);
    log.debug("http requestRaw", {
      authKind: o.auth.kind,
      method: o.method,
      url: url.pathname,
      redirect: extra?.redirect ?? "follow",
    });
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      o.timeoutMs ?? this.opts.timeouts.readMs,
    );
    const isFormData =
      typeof FormData !== "undefined" && o.body instanceof FormData;
    const init: RequestInit = {
      method: o.method,
      headers: this.buildHeaders(o, token, isFormData),
      signal: controller.signal,
      ...(extra?.redirect ? { redirect: extra.redirect } : {}),
    };
    if (o.body !== undefined) {
      init.body = isFormData ? (o.body as FormData) : JSON.stringify(o.body);
    }
    try {
      return await fetch(url, init);
    } finally {
      clearTimeout(timer);
    }
  }
}
