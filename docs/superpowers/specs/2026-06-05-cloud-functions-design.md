# Cloud Functions Invocation — Design Spec

**Date:** 2026-06-05
**Status:** Approved (brainstorming) → ready for implementation plan
**Packages:** `@viu/emporix-sdk`, `@viu/emporix-sdk-react`

## Overview

Add a generic way to invoke Emporix-hosted **cloud functions** from both the core SDK and the React bindings. A cloud function is arbitrary custom server logic deployed in the tenant; request and response bodies are entirely consumer-defined, so the surface is generic (`<TRes, TReq>`) rather than schema-generated.

## Goal

`client.cloudFunctions.invoke(functionId, options, auth)` (SDK) plus `useInvokeCloudFunction` (mutation) and `useCloudFunction` (query) (React) — typed by the developer, supporting GET/POST/PUT/DELETE, optional sub-paths, query params, custom headers, and service / customer / anonymous / raw auth.

## Emporix endpoint (verified against the docs)

- Root: `https://api.emporix.io/cloud-functions/{TENANT}/functions/{FUNCTION_ID}`
- Extensible with sub-paths the function exposes: `.../functions/{FUNCTION_ID}/products`
- HTTP methods: **GET, POST, PUT, DELETE**
- Auth: the platform validates **service, customer, or anonymous** tokens (no token validation inside the function). `raw` (caller-supplied bearer) also works via the SDK's auth layer.
- Request: `Content-Type: application/json`, `Authorization: Bearer …`, arbitrary JSON body.
- Response: whatever the function returns (arbitrary JSON; may be empty).
- The `FUNCTION_ID` differs per function (e.g. `23eef339-6e55-4849-b884-b6643ad01406`).

Source: developer.emporix.io — "Extension and Cloud Function Hosting".

There is **no OpenAPI schema** for arbitrary functions → this is a hand-written generic service, not codegen.

## Architecture

Two units, each with one responsibility:

1. **`CloudFunctionsService`** (core SDK) — builds the path, delegates to the shared `HttpClient`, returns the parsed JSON typed as `TRes`. Stateless; depends only on `ClientContext` (tenant, http, auth) like every other service.
2. **React hooks** — thin React-Query wrappers over `client.cloudFunctions.invoke`, adding auto-auth resolution and (for the query hook) caching.

### Component 1 — SDK `CloudFunctionsService`

Registered on `EmporixClient` as `client.cloudFunctions` via `mk("cloud-functions")`. Base path: `/cloud-functions/${tenant}/functions`.

```ts
export interface InvokeCloudFunctionOptions<TReq = unknown> {
  /** HTTP method. Default: "POST" (the canonical invoke). */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Optional sub-path the function exposes, e.g. "products" → .../functions/{id}/products. Leading slash optional. */
  path?: string;
  /** Request body (arbitrary JSON). */
  body?: TReq;
  /** Query-string params. */
  query?: Record<string, string | number | undefined>;
  /** Extra request headers (Content-Type: application/json is the default). */
  headers?: Record<string, string>;
}

export class CloudFunctionsService {
  constructor(private readonly ctx: ClientContext) {}
  private base(): string {
    return `/cloud-functions/${this.ctx.tenant}/functions`;
  }
  /**
   * Invokes a cloud function. Request/response types are caller-defined.
   * Default auth is anonymous; pass auth.service() / auth.customer(token) /
   * auth.raw(token) to override.
   */
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
```

(The `...(x ? { … } : {})` spreads keep `exactOptionalPropertyTypes` happy — no explicit `undefined` assigned to optional `RequestOptions` fields.)

Exports from `packages/sdk/src/index.ts`: `CloudFunctionsService`, `InvokeCloudFunctionOptions`.

### Component 2 — React hooks

Both resolve auth automatically (customer if a token is stored, else anonymous) with an optional `auth` override. **Service auth is intentionally not exposed in React** — service credentials must never live in a storefront bundle. A consumer needing a specific token passes `auth: auth.raw(token)`.

**a) `useInvokeCloudFunction` — mutation (imperative, any method):**

```ts
export interface InvokeCloudFunctionVars<TReq = unknown> extends InvokeCloudFunctionOptions<TReq> {
  functionId: string;
  /** Override the auto-resolved auth (customer-if-token-else-anonymous). */
  auth?: AuthContext;
}

export function useInvokeCloudFunction<TRes = unknown, TReq = unknown>():
  UseMutationResult<TRes, unknown, InvokeCloudFunctionVars<TReq>>;
```

`functionId` is passed per call, so one hook invokes any number of functions:
`mutateAsync({ functionId: "23eef…", body: { name: "John" } })`.

**b) `useCloudFunction` — query (GET-style with caching):**

```ts
export function useCloudFunction<TRes = unknown>(
  functionId: string | undefined,
  options?: InvokeCloudFunctionOptions & { auth?: AuthContext },
  queryOptions?: { enabled?: boolean; staleTime?: number },
): UseQueryResult<TRes>;
```

- Default `method: "GET"`.
- Query key: `emporixKey("cloud-function", [functionId ?? null, options?.path ?? null, options?.query ?? null], { tenant, authKind })` (follows the existing `emporixKey` convention).
- `enabled` is `false` when `functionId` is `undefined` (and respects an explicit `queryOptions.enabled`).

Exports from `packages/react/src/index.ts` (+ hooks barrel): `useInvokeCloudFunction`, `useCloudFunction`, `InvokeCloudFunctionVars`.

## Data flow

1. Consumer calls the hook/service with `functionId` + options + (optional) auth.
2. React hook resolves auth: `vars.auth ?? (storedToken ? auth.customer(storedToken) : auth.anonymous())`.
3. `CloudFunctionsService.invoke` builds `/cloud-functions/{tenant}/functions/{id}[/sub]`, delegates to `HttpClient.request`.
4. `HttpClient` attaches the bearer token (service/customer/anonymous/raw resolved by the `TokenProvider`), sends JSON, parses the JSON response as `TRes`.

## Error handling

No new error types. `HttpClient.request` already throws the typed `EmporixError` subclasses on non-2xx (e.g. `EmporixInsufficientScopeError` on 403, `EmporixNotFoundError` on 404). The mutation/query surface those via React-Query's `error`. An empty (204) response resolves to `undefined`.

## Testing

- **SDK** (`packages/sdk/tests/services/cloud-functions.test.ts`, MSW): default POST to `/cloud-functions/{tenant}/functions/{id}`; GET; sub-path append (`/products`); query params forwarded; body forwarded; each auth kind reaches the right bearer (anonymous default, customer/service/raw override); error propagation (403 → throws); empty 204 → `undefined`.
- **React** (`packages/react/tests/use-cloud-functions.test.tsx`, MSW + renderHook): `useInvokeCloudFunction` mutateAsync resolves the typed response; auto-auth uses the stored customer token when present, anonymous otherwise; `auth` override honoured. `useCloudFunction` GET caching; disabled when `functionId` is `undefined`; `enabled` gating.

## Out of scope (YAGNI)

- Non-JSON responses (text/binary). `invoke` parses JSON. A `parse: "json" | "text" | "raw"` option can be a later follow-up if needed.
- Listing/managing/deploying cloud functions (the Hosting/admin APIs) — this spec covers **invocation** only.
- Streaming responses.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/sdk/src/services/cloud-functions.ts` | `CloudFunctionsService` + `InvokeCloudFunctionOptions` |
| `packages/sdk/src/cloud-functions.ts` | barrel re-export (service + types) |
| `packages/sdk/src/client.ts` | register `client.cloudFunctions` |
| `packages/sdk/src/index.ts` | export the barrel |
| `packages/sdk/tests/services/cloud-functions.test.ts` | SDK tests |
| `packages/react/src/hooks/use-cloud-functions.ts` | `useInvokeCloudFunction`, `useCloudFunction` |
| `packages/react/src/hooks/index.ts` + `src/index.ts` | export the hooks |
| `packages/react/tests/use-cloud-functions.test.tsx` | React tests |
| `.changeset/cloud-functions.md` | release entry (`@viu/emporix-sdk` + `@viu/emporix-sdk-react` minor) |

Commitlint: `cloud-functions` is not an allowed scope → commits use `sdk` / `react`.
