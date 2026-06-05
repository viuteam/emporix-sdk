# Cloud Functions Invocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic cloud-function invocation to the SDK (`client.cloudFunctions.invoke`) and React (`useInvokeCloudFunction`, `useCloudFunction`).

**Architecture:** A hand-written `CloudFunctionsService` builds `/cloud-functions/{tenant}/functions/{id}[/sub]` and delegates to the shared `HttpClient`, returning the parsed JSON typed as `TRes`. Two thin React-Query hooks wrap it, adding auto-auth (customer-if-token-else-anonymous) + optional override; the query hook adds caching.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), React-Query, Vitest + MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-05-cloud-functions-design.md`.

---

## Task 1: SDK — `CloudFunctionsService`

**Files:**
- Create: `packages/sdk/src/services/cloud-functions.ts`
- Create: `packages/sdk/src/cloud-functions.ts` (barrel)
- Modify: `packages/sdk/src/core/logger.ts` (add `"cloud-functions"` to `ServiceName`)
- Modify: `packages/sdk/src/client.ts` (register `client.cloudFunctions`)
- Modify: `packages/sdk/src/index.ts` (export the barrel)
- Test: `packages/sdk/tests/services/cloud-functions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/cloud-functions.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CloudFunctionsService } from "../../src/services/cloud-functions";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const FID = "23eef339-6e55-4849-b884-b6643ad01406";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "cloud-functions" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CloudFunctionsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("CloudFunctionsService.invoke", () => {
  it("defaults to POST with anonymous auth, forwards the body, returns parsed JSON", async () => {
    let captured: { method: string; auth: string | null; body: unknown } | null = null;
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, async ({ request }) => {
        captured = {
          method: request.method,
          auth: request.headers.get("authorization"),
          body: await request.json(),
        };
        return HttpResponse.json({ greeting: "Hello John" });
      }),
    );
    const res = await harness().invoke<{ greeting: string }>(FID, { body: { name: "John" } });
    expect(res.greeting).toBe("Hello John");
    expect(captured!.method).toBe("POST");
    expect(captured!.auth).toBe("Bearer anon-tok");
    expect(captured!.body).toEqual({ name: "John" });
  });

  it("supports GET and forwards query params", async () => {
    let url = "";
    server.use(
      http.get(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    await harness().invoke(FID, { method: "GET", query: { page: 2 } }, CUST);
    expect(new URL(url).searchParams.get("page")).toBe("2");
  });

  it("appends a sub-path (leading slash optional)", async () => {
    let hit = false;
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}/products`, () => {
        hit = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await harness().invoke(FID, { path: "/products" });
    expect(hit).toBe(true);
  });

  it("uses the customer token when customer auth is passed", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    await harness().invoke(FID, {}, CUST);
    expect(authHeader).toBe("Bearer cust-tok");
  });

  it("propagates a 403 as a thrown error", async () => {
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, () =>
        HttpResponse.json({ message: "forbidden" }, { status: 403 }),
      ),
    );
    await expect(harness().invoke(FID, {}, CUST)).rejects.toThrow();
  });

  it("resolves to undefined on an empty 204", async () => {
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`,
        () => new HttpResponse(null, { status: 204 })),
    );
    await expect(harness().invoke(FID, {}, CUST)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-sdk test cloud-functions`
Expected: FAIL — cannot find `../../src/services/cloud-functions`.

- [ ] **Step 3: Add `"cloud-functions"` to `ServiceName`**

In `packages/sdk/src/core/logger.ts`, add a member to the `ServiceName` union (next to `"fee"`):

```ts
  | "fee"
  | "cloud-functions"
```

- [ ] **Step 4: Create the service**

Create `packages/sdk/src/services/cloud-functions.ts`:

```ts
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
```

- [ ] **Step 5: Register on `EmporixClient`**

In `packages/sdk/src/client.ts`:
- Add the import (with the other service imports): `import { CloudFunctionsService } from "./services/cloud-functions";`
- Add the field (with the other `readonly` service fields): `readonly cloudFunctions: CloudFunctionsService;`
- Add the construction (next to `this.fees = …`): `this.cloudFunctions = new CloudFunctionsService(mk("cloud-functions"));`

- [ ] **Step 6: Create the barrel + export from index**

Create `packages/sdk/src/cloud-functions.ts`:

```ts
export { CloudFunctionsService } from "./services/cloud-functions";
export type { InvokeCloudFunctionOptions } from "./services/cloud-functions";
```

In `packages/sdk/src/index.ts`, add (next to the other `export * from "./…"` service barrels):

```ts
export * from "./cloud-functions";
```

- [ ] **Step 7: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-sdk test cloud-functions`
Expected: PASS (all 6 cases).

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm -F @viu/emporix-sdk typecheck
git add packages/sdk/src/services/cloud-functions.ts packages/sdk/src/cloud-functions.ts packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/cloud-functions.test.ts
git commit -m "feat(sdk): add CloudFunctionsService.invoke (generic cloud-function calls)"
```

---

## Task 2: React — `useInvokeCloudFunction` + `useCloudFunction`

**Files:**
- Create: `packages/react/src/hooks/use-cloud-functions.ts`
- Modify: `packages/react/src/hooks/index.ts` (export the hooks)
- Modify: `packages/react/src/index.ts` (re-export the hooks)
- Test: `packages/react/tests/use-cloud-functions.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/use-cloud-functions.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useInvokeCloudFunction, useCloudFunction } from "../src/hooks/use-cloud-functions";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const FID = "fn-1";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(opts: { storage?: EmporixStorage } = {}) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const storage = opts.storage ?? createMemoryStorage();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  return { Wrapper, storage };
}

describe("useInvokeCloudFunction", () => {
  it("invokes (POST) and resolves the typed response; anonymous when no token", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cloud-functions/acme/functions/fn-1", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ greeting: "hi" });
      }),
    );
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useInvokeCloudFunction<{ greeting: string }>(), { wrapper: Wrapper });
    let res: { greeting: string } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ functionId: FID, body: { name: "x" } });
    });
    expect(res?.greeting).toBe("hi");
    expect(authHeader).toBe("Bearer anon");
  });

  it("uses the stored customer token automatically", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cloud-functions/acme/functions/fn-1", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    const storage = createMemoryStorage();
    storage.setCustomerToken("cust-9");
    const { Wrapper } = wrap({ storage });
    const { result } = renderHook(() => useInvokeCloudFunction(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ functionId: FID });
    });
    expect(authHeader).toBe("Bearer cust-9");
  });

  it("honours an explicit auth override", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cloud-functions/acme/functions/fn-1", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useInvokeCloudFunction(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ functionId: FID, auth: auth.raw("raw-tok") });
    });
    expect(authHeader).toBe("Bearer raw-tok");
  });
});

describe("useCloudFunction", () => {
  it("GETs and caches; disabled when functionId is undefined", async () => {
    let hits = 0;
    server.use(
      http.get("https://api.emporix.io/cloud-functions/acme/functions/fn-1", () => {
        hits += 1;
        return HttpResponse.json({ value: 42 });
      }),
    );
    const { Wrapper } = wrap();
    // disabled
    const disabled = renderHook(() => useCloudFunction<{ value: number }>(undefined), { wrapper: Wrapper });
    expect(disabled.result.current.fetchStatus).toBe("idle");
    // enabled
    const { result } = renderHook(() => useCloudFunction<{ value: number }>(FID), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.value).toBe(42);
    expect(hits).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test use-cloud-functions`
Expected: FAIL — cannot find `../src/hooks/use-cloud-functions`. (If the import of `CloudFunctionsService` from the built SDK also fails, build the SDK first: `pnpm -F @viu/emporix-sdk build`.)

- [ ] **Step 3: Create the hooks**

Create `packages/react/src/hooks/use-cloud-functions.ts`:

```ts
import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type InvokeCloudFunctionOptions,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Variables for {@link useInvokeCloudFunction}. */
export interface InvokeCloudFunctionVars<TReq = unknown>
  extends InvokeCloudFunctionOptions<TReq> {
  functionId: string;
  /** Override the auto-resolved auth (customer-if-token-else-anonymous). */
  auth?: AuthContext;
}

/**
 * Imperatively invoke a cloud function (any method). Auth is resolved
 * automatically (customer if a token is stored, else anonymous) unless an
 * explicit `auth` is passed in the variables. Service auth is intentionally
 * not exposed in React.
 */
export function useInvokeCloudFunction<TRes = unknown, TReq = unknown>(): UseMutationResult<
  TRes,
  unknown,
  InvokeCloudFunctionVars<TReq>
> {
  const { client, storage } = useEmporix();
  return useMutation({
    mutationFn: (vars: InvokeCloudFunctionVars<TReq>) => {
      const { functionId, auth: authOverride, ...options } = vars;
      const token = storage.getCustomerToken();
      const authCtx = authOverride ?? (token ? auth.customer(token) : auth.anonymous());
      return client.cloudFunctions.invoke<TRes, TReq>(functionId, options, authCtx);
    },
  });
}

/**
 * Query a (read-style) cloud function with React-Query caching. Defaults to
 * GET. Disabled while `functionId` is `undefined`. Auth resolves like
 * {@link useInvokeCloudFunction}; pass `options.auth` to override.
 */
export function useCloudFunction<TRes = unknown>(
  functionId: string | undefined,
  options?: InvokeCloudFunctionOptions & { auth?: AuthContext },
  queryOptions?: { enabled?: boolean; staleTime?: number },
): UseQueryResult<TRes> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  const { auth: authOverride, ...invokeOptions } = options ?? {};
  const authCtx = authOverride ?? (token ? auth.customer(token) : auth.anonymous());
  return useQuery({
    queryKey: emporixKey(
      "cloud-function",
      [functionId ?? null, invokeOptions.path ?? null, invokeOptions.query ?? null],
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous" },
    ),
    enabled: (queryOptions?.enabled ?? true) && functionId !== undefined,
    ...(queryOptions?.staleTime !== undefined ? { staleTime: queryOptions.staleTime } : {}),
    queryFn: () =>
      client.cloudFunctions.invoke<TRes>(
        functionId as string,
        { method: "GET", ...invokeOptions },
        authCtx,
      ),
  });
}
```

- [ ] **Step 4: Export the hooks**

In `packages/react/src/hooks/index.ts`, add:

```ts
export {
  useInvokeCloudFunction,
  useCloudFunction,
  type InvokeCloudFunctionVars,
} from "./use-cloud-functions";
```

In `packages/react/src/index.ts`, add `useInvokeCloudFunction` and `useCloudFunction` to the existing hook re-export list (and `InvokeCloudFunctionVars` to the type re-exports if a separate type block exists; otherwise the `export … from "./hooks"` star already carries it).

- [ ] **Step 5: Build SDK (hooks resolve it from dist), run the test**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test use-cloud-functions
```
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm -F @viu/emporix-sdk-react typecheck
git add packages/react/src/hooks/use-cloud-functions.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-cloud-functions.test.tsx
git commit -m "feat(react): add useInvokeCloudFunction + useCloudFunction"
```

---

## Task 3: Documentation

**Files:**
- Create: `docs/cloud-functions.md`

- [ ] **Step 1: Write the doc**

Create `docs/cloud-functions.md` (mirrors the style of `docs/react.md` / `docs/auth.md`):

````markdown
# Cloud Functions

Invoke tenant-hosted [Emporix cloud functions](https://developer.emporix.io/ce/extensibility-and-integrations/extensibility-cases/extension-hosting)
from the SDK or React. Request and response bodies are **whatever your function
returns** — the API is generic (`<TRes, TReq>`), not schema-generated.

Endpoint: `/cloud-functions/{tenant}/functions/{functionId}[/sub-path]`. Methods:
`GET`, `POST` (default), `PUT`, `DELETE`. Auth: `service`, `customer`,
`anonymous`, or `raw` — the platform validates the token; you don't validate it
inside the function.

## SDK

```ts
// POST {} → returns the function's JSON, typed by you
const res = await client.cloudFunctions.invoke<{ greeting: string }>(
  "23eef339-6e55-4849-b884-b6643ad01406",
  { body: { name: "John" } },               // method defaults to POST
);

// GET a read-style function with a sub-path + query, as a customer
const list = await client.cloudFunctions.invoke<Product[]>(
  fnId,
  { method: "GET", path: "products", query: { page: 2 } },
  auth.customer(token),
);

// Service-account call (Node/backend only — never ship service creds to a browser)
await client.cloudFunctions.invoke(fnId, { body: payload }, auth.service());
```

`invoke<TRes, TReq>(functionId, options?, auth?)`:

| Option | Default | Notes |
|---|---|---|
| `method` | `"POST"` | `GET` / `POST` / `PUT` / `DELETE` |
| `path` | — | sub-path the function exposes (leading slash optional) |
| `body` | — | arbitrary JSON request |
| `query` | — | query-string params |
| `headers` | — | extra headers (`Content-Type: application/json` is default) |
| `auth` (3rd arg) | `auth.anonymous()` | `auth.service()` / `auth.customer(token)` / `auth.raw(token)` |

A non-2xx response throws the typed `EmporixError` subclasses (e.g. 403 →
`EmporixInsufficientScopeError`); an empty `204` resolves to `undefined`.

## React

Auth resolves automatically — **customer** if a token is stored, else
**anonymous** — with an optional `auth` override. Service auth is not exposed in
React (no secrets in a storefront bundle); pass `auth: auth.raw(token)` if you
hold a token yourself.

```tsx
// Imperative (any method)
const invoke = useInvokeCloudFunction<{ greeting: string }>();
await invoke.mutateAsync({ functionId: fnId, body: { name: "John" } });

// Read-style with caching (GET, disabled until functionId is set)
const { data, isLoading } = useCloudFunction<Product[]>(fnId, {
  path: "products",
  query: { page: 2 },
});
```
````

- [ ] **Step 2: Verify it renders (fences balanced)**

Run:
```bash
grep -c '^```' docs/cloud-functions.md
```
Expected: an even number (balanced code fences).

- [ ] **Step 3: Commit**

```bash
git add docs/cloud-functions.md
git commit -m "docs(docs): document cloud-function invocation"
```

---

## Task 4: Changeset, full verify, finish

- [ ] **Step 1: Changeset**

Create `.changeset/cloud-functions.md`:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat: invoke Emporix cloud functions

Adds `client.cloudFunctions.invoke<TRes, TReq>(functionId, { method?, path?,
body?, query?, headers? }, auth)` — a generic call to tenant cloud functions
(`/cloud-functions/{tenant}/functions/{id}[/sub]`), with GET/POST/PUT/DELETE and
service / customer / anonymous / raw auth (default anonymous). Adds the React
hooks `useInvokeCloudFunction` (mutation, any method) and `useCloudFunction`
(GET-style query with caching), both with auto-auth (customer-if-token-else-
anonymous) and an optional override.
```

- [ ] **Step 2: Full verify**

```bash
pnpm -r --filter "./packages/*" build
pnpm -r typecheck
pnpm -r test
```
Expected: all pass (SDK + React suites green; the new tests included).

- [ ] **Step 3: Commit**

```bash
git add .changeset/cloud-functions.md
git commit -m "chore(release): add cloud-functions changeset"
```

- [ ] **Step 4: Finish**

**REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch`. Branch `feat/cloud-functions` (off `main`).

---

## Self-Review

- **Spec coverage:** SDK `invoke` w/ method/path/body/query/headers + 4 auth kinds + default anonymous + JSON/204 (T1); `useInvokeCloudFunction` mutation w/ auto-auth + override (T2); `useCloudFunction` query w/ caching + disabled gating (T2); exports + registration (T1/T2); changeset + verify + finish (T3). All spec sections covered.
- **No placeholders:** every code/command step is concrete; the only "add to the existing list" instructions name the exact symbols.
- **Type consistency:** `InvokeCloudFunctionOptions<TReq>` (SDK) is reused by `InvokeCloudFunctionVars<TReq>` (React) and `useCloudFunction`'s `options`. `invoke<TRes, TReq>` generic order is identical in service, mutation, and query. `client.cloudFunctions` name is identical in client.ts (T1) and both hooks (T2). `"cloud-functions"` added to `ServiceName` (T1 Step 3) so `mk("cloud-functions")` (T1 Step 5) typechecks.
- **YAGNI:** JSON only; invocation only (no listing/deploy) — matches the spec's out-of-scope.
