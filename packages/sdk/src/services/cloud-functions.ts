import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";

/** Options for {@link CloudFunctionsService.invoke}. */
export interface InvokeCloudFunctionOptions<TReq = unknown> {
  /** HTTP method. Default: "POST" (the canonical invoke). */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Optional sub-path the function exposes (leading slash optional). */
  path?: string;
  /** Request body (arbitrary JSON). */
  body?: TReq;
  /** Query-string params. */
  query?: Record<string, string | number | undefined>;
  /** Extra request headers (Content-Type: application/json is the default). */
  headers?: Record<string, string>;
}

/**
 * Invokes Emporix-hosted cloud functions. Request/response shapes are
 * caller-defined (generic) — there is no schema. Auth may be service,
 * customer, anonymous, or raw; the default is anonymous.
 */
export class CloudFunctionsService {
  static readonly channel = "cloud-functions" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/cloud-functions/${this.ctx.tenant}/functions`;
  }

  async invoke<TRes = unknown, TReq = unknown>(
    functionId: string,
    options: InvokeCloudFunctionOptions<TReq> = {},
    authCtx: AuthContext = auth.anonymous(),
  ): Promise<TRes> {
    const sub = options.path ? `/${options.path.replace(/^\//, "")}` : "";
    return this.ctx.http.request<TRes>({
      method: options.method ?? "POST",
      path: `${this.base()}/${functionId}${sub}`,
      auth: authCtx,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.query ? { query: options.query } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
  }
}
