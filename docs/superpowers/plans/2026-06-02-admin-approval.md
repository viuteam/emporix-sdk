# Approval Service Binding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> subagent-driven-development) to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the Emporix Approval Service into the core SDK (`client.approvals`)
and add customer-only React hooks — the final unbound spec in the catalog.

**Architecture:** Alias-first types over a freshly generated `approval` codegen
target; one `ApprovalService` (configuration pattern); four customer-only React
hooks reusing `useCustomerOnlyCtx` + `emporixKey`.

**Tech Stack:** TypeScript, `@hey-api/openapi-ts`, Vitest + MSW, `@tanstack/react-query`.

Branch: `feat/admin-approval` (new branch off up-to-date `main`).

---

### Task 1: Generate the `approval` codegen target + verify shapes

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Generated (output): `packages/sdk/src/generated/approval/types.gen.ts`

- [ ] **Step 1: Add the spec to the SPECS map**

In `fetch-specs.ts`, add to the `SPECS` object (note the `approval-api-reference`
path segment — NOT `api-reference`):

```ts
"approval-service": `${BASE}/companies-and-customers/approval-service/approval-api-reference/api.yml`,
```

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate
```
Expected: `packages/sdk/src/generated/approval/types.gen.ts` written, no errors.

- [ ] **Step 3: Pin the generated type names**

Inspect the generated file and confirm the exact exported names used by the aliases
in Task 2. Run:
```bash
grep -nE "export type (GetApprovalResponse|CreateCartApprovalRequest|CreateQuoteApprovalRequest|UpdateApprovalRequest|ApprovalId|ApprovalPermittedRequest|ApprovalPermittedResponse|SearchUsersRequest|ApprovalSearchUsersResponse|User) " packages/sdk/src/generated/approval/types.gen.ts
```
Expected: each name resolves. Record any rename (hey-api may suffix collisions, e.g.
`User` → `User2`). Note in particular whether `UpdateApprovalRequest` is already an
array type (`Array<…>`) — it should be (`type: array` upstream). If a name differs,
use the actual generated name in Task 2 and adjust the alias.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/src/generated/approval
git commit -m "chore(sdk): generate approval service types"
```

---

### Task 2: Public types — `approval-types.ts`

**Files:**
- Create: `packages/sdk/src/services/approval-types.ts`
- Test: `packages/sdk/tests/services/approval-types.test.ts`

- [ ] **Step 1: Write the failing type test**

Create `packages/sdk/tests/services/approval-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
  ApprovalPermittedInput,
  ApprovalPermittedResult,
  ApprovalUsersQuery,
  ApprovalUsersResult,
} from "../../src/services/approval-types";

describe("approval-types", () => {
  it("aliases the read/list shapes", () => {
    expectTypeOf<ApprovalList>().toEqualTypeOf<Approval[]>();
    expectTypeOf<Approval>().toHaveProperty("id");
    expectTypeOf<Approval>().toHaveProperty("status");
  });

  it("create body is a cart-or-quote union and returns an id", () => {
    expectTypeOf<ApprovalCreated>().toHaveProperty("id");
    // ApprovalInput is assignable from at least the cart variant
    expectTypeOf<ApprovalInput>().not.toBeNever();
  });

  it("patch is an op-array; permitted/users shapes resolve", () => {
    expectTypeOf<ApprovalPatch>().toBeArray();
    expectTypeOf<ApprovalPermittedResult>().toHaveProperty("permitted");
    expectTypeOf<ApprovalUsersResult>().toBeArray();
    expectTypeOf<ApprovalPermittedInput>().not.toBeNever();
    expectTypeOf<ApprovalUsersQuery>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

```bash
pnpm -F @viu/emporix-sdk test approval-types
```
Expected: FAIL — cannot find `../../src/services/approval-types`.

- [ ] **Step 3: Create the types module**

Create `packages/sdk/src/services/approval-types.ts` (adjust any name to the
actual generated name pinned in Task 1, Step 3):

```ts
/**
 * Public types for the Approval Service — stable names aliased over the generated
 * `approval` types (single source of truth; faithful required/optional flags).
 *
 * Every endpoint is CustomerAccessToken-only (B2B approval workflows).
 */
import type {
  GetApprovalResponse,
  CreateCartApprovalRequest,
  CreateQuoteApprovalRequest,
  UpdateApprovalRequest,
  ApprovalId,
  ApprovalPermittedRequest,
  ApprovalPermittedResponse,
  SearchUsersRequest,
  User,
} from "../generated/approval";

/** An approval document (read shape). */
export type Approval = GetApprovalResponse;
/** Response of `listApprovals` — a plain array of approvals. */
export type ApprovalList = Approval[];
/** Create body (`POST /approvals`) — a cart or quote approval request. */
export type ApprovalInput = CreateCartApprovalRequest | CreateQuoteApprovalRequest;
/** Partial-update body (`PATCH /approvals/{id}`) — a JSON-Patch op-array. */
export type ApprovalPatch = UpdateApprovalRequest;
/** `POST /approvals` 201 response — the created approval's `{ id }`. */
export type ApprovalCreated = ApprovalId;
/** Body for `checkPermitted` (`POST /approval/permitted`). */
export type ApprovalPermittedInput = ApprovalPermittedRequest;
/** Result of `checkPermitted` — `{ permitted, action, status?, approvalId? }`. */
export type ApprovalPermittedResult = ApprovalPermittedResponse;
/** Body for `searchApprovers` (`POST /search/users`). */
export type ApprovalUsersQuery = SearchUsersRequest;
/** Result of `searchApprovers` — a plain array of approver users. */
export type ApprovalUsersResult = User[];
```

> If `UpdateApprovalRequest` did NOT generate as an array, change the alias to
> `export type ApprovalPatch = UpdateApprovalRequest[];`. If `User` generated as
> `User2` (collision), import + use that name for `ApprovalUsersResult`.

- [ ] **Step 4: Run it — expect PASS**

```bash
pnpm -F @viu/emporix-sdk test approval-types
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/approval-types.ts packages/sdk/tests/services/approval-types.test.ts
git commit -m "feat(sdk): add approval public types"
```

---

### Task 3: `ApprovalService` + facade

**Files:**
- Create: `packages/sdk/src/services/approval.ts`
- Create: `packages/sdk/src/approval.ts` (facade)
- Test: `packages/sdk/tests/services/approval.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `packages/sdk/tests/services/approval.test.ts` (mirrors `catalog.test.ts`
harness; uses a customer token):

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ApprovalService } from "../../src/services/approval";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "approval" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ApprovalService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer", token: "cust-tok" } as const;
const BASE = "https://api.emporix.io/approval/acme";

describe("ApprovalService", () => {
  it("listApprovals GETs /approvals with the customer token + query", async () => {
    let seenAuth: string | null = null;
    let search = "";
    server.use(
      http.get(`${BASE}/approvals`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        search = new URL(request.url).search;
        return HttpResponse.json([{ id: "a1" }]);
      }),
    );
    const out = await svc().listApprovals({ pageSize: 10, q: "status:PENDING" }, CUST);
    expect(out).toEqual([{ id: "a1" }]);
    expect(seenAuth).toBe("Bearer cust-tok");
    expect(search).toContain("pageSize=10");
    expect(search).toContain("q=status%3APENDING");
  });

  it("getApproval GETs /approvals/{id}", async () => {
    server.use(http.get(`${BASE}/approvals/a1`, () => HttpResponse.json({ id: "a1" })));
    expect((await svc().getApproval("a1", CUST)) as { id?: string }).toEqual({ id: "a1" });
  });

  it("createApproval POSTs the body and returns the created id", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/approvals`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a1" }, { status: 201 });
      }),
    );
    const created = await svc().createApproval({ resource: { resourceType: "CART" } } as never, CUST);
    expect(created.id).toBe("a1");
    expect(body).toEqual({ resource: { resourceType: "CART" } });
  });

  it("updateApproval PATCHes a JSON-Patch op-array and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/approvals/a1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const ops = [{ op: "replace", path: "/status", value: "APPROVED" }] as never;
    await expect(svc().updateApproval("a1", ops, CUST)).resolves.toBeUndefined();
    expect(body).toEqual([{ op: "replace", path: "/status", value: "APPROVED" }]);
  });

  it("deleteApproval DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/approvals/a1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteApproval("a1", CUST)).resolves.toBeUndefined();
  });

  it("checkPermitted POSTs /approval/permitted and returns the permitted flag", async () => {
    server.use(
      http.post(`${BASE}/approval/permitted`, () =>
        HttpResponse.json({ permitted: true, action: "CREATE" }),
      ),
    );
    const out = await svc().checkPermitted({ resourceType: "CART", resourceId: "c1" } as never, CUST);
    expect(out.permitted).toBe(true);
  });

  it("searchApprovers POSTs /search/users and returns an array", async () => {
    server.use(
      http.post(`${BASE}/search/users`, () => HttpResponse.json([{ id: "u1" }])),
    );
    const out = await svc().searchApprovers({ resourceType: "CART", resourceId: "c1" } as never, CUST);
    expect(out).toEqual([{ id: "u1" }]);
  });

  it("getApproval throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/approvals/NOPE`, () =>
        HttpResponse.json({ status: 404, message: "x" }, { status: 404 }),
      ),
    );
    await expect(svc().getApproval("NOPE", CUST)).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("encodeURIComponent-escapes the approval id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/approval/acme/approvals/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getApproval("a/b", CUST);
    expect(pathname).toBe("/approval/acme/approvals/a%2Fb");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

```bash
pnpm -F @viu/emporix-sdk test tests/services/approval.test.ts
```
Expected: FAIL — cannot find `../../src/services/approval`.

- [ ] **Step 3: Implement the service**

Create `packages/sdk/src/services/approval.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
  ApprovalPermittedInput,
  ApprovalPermittedResult,
  ApprovalUsersQuery,
  ApprovalUsersResult,
} from "./approval-types";

export type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
  ApprovalPermittedInput,
  ApprovalPermittedResult,
  ApprovalUsersQuery,
  ApprovalUsersResult,
} from "./approval-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Approval Service (`/approval/{tenant}/…`): B2B cart/quote approval
 * workflows — list/view approvals, create an approval request, approve or reject
 * via JSON-Patch, plus permitted-checks and approver search.
 *
 * Every endpoint is **CustomerAccessToken-only**. The trailing `auth` keeps the
 * SDK's uniform method shape, but a customer token is required in practice — pass
 * `auth.customer(token)` (the React hooks supply the browser context). The
 * service token will be rejected by Emporix.
 */
export class ApprovalService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/approval/${this.ctx.tenant}`;
  }

  /** List approvals (paged via `pageNumber`/`pageSize`/`sort`/`q`). Returns an array. */
  async listApprovals(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ApprovalList> {
    return this.ctx.http.request<ApprovalList>({
      method: "GET",
      path: `${this.base()}/approvals`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a single approval by id. */
  async getApproval(approvalId: string, auth: AuthContext = SERVICE): Promise<Approval> {
    return this.ctx.http.request<Approval>({
      method: "GET",
      path: `${this.base()}/approvals/${encodeURIComponent(approvalId)}`,
      auth,
    });
  }

  /** Create an approval request (cart or quote). Returns the created `{ id }`. */
  async createApproval(input: ApprovalInput, auth: AuthContext = SERVICE): Promise<ApprovalCreated> {
    return this.ctx.http.request<ApprovalCreated>({
      method: "POST",
      path: `${this.base()}/approvals`,
      auth,
      body: input,
    });
  }

  /** Approve/reject/amend an approval via a JSON-Patch op-array (`PATCH`). */
  async updateApproval(
    approvalId: string,
    ops: ApprovalPatch,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/approvals/${encodeURIComponent(approvalId)}`,
      auth,
      body: ops,
    });
  }

  /** Delete an approval by id. */
  async deleteApproval(approvalId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/approvals/${encodeURIComponent(approvalId)}`,
      auth,
    });
  }

  /** Check whether an operation on a resource is permitted / needs approval. */
  async checkPermitted(
    input: ApprovalPermittedInput,
    auth: AuthContext = SERVICE,
  ): Promise<ApprovalPermittedResult> {
    return this.ctx.http.request<ApprovalPermittedResult>({
      method: "POST",
      path: `${this.base()}/approval/permitted`,
      auth,
      body: input,
    });
  }

  /** Search for users eligible to approve a resource. Returns an array. */
  async searchApprovers(
    input: ApprovalUsersQuery,
    auth: AuthContext = SERVICE,
  ): Promise<ApprovalUsersResult> {
    return this.ctx.http.request<ApprovalUsersResult>({
      method: "POST",
      path: `${this.base()}/search/users`,
      auth,
      body: input,
    });
  }
}
```

- [ ] **Step 4: Create the facade**

Create `packages/sdk/src/approval.ts`:

```ts
export * from "./services/approval";
```

- [ ] **Step 5: Run it — expect PASS**

```bash
pnpm -F @viu/emporix-sdk test tests/services/approval.test.ts
```
Expected: PASS (all 9 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/approval.ts packages/sdk/src/approval.ts packages/sdk/tests/services/approval.test.ts
git commit -m "feat(sdk): add ApprovalService"
```

---

### Task 4: Wire into client + logger + barrel

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/approval-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

Create `packages/sdk/tests/services/approval-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ApprovalService } from "../../src/services/approval";

function client() {
  return new EmporixClient({
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  } as never);
}

describe("approval wiring", () => {
  it("exposes client.approvals as an ApprovalService", () => {
    expect(client().approvals).toBeInstanceOf(ApprovalService);
  });

  it("accepts the 'approval' logger service name", () => {
    expect(() => client().getLogLevel("approval")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
pnpm -F @viu/emporix-sdk test approval-wiring
```
Expected: FAIL — `client.approvals` undefined / type error on `"approval"`.

- [ ] **Step 3: Add `"approval"` to the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add to the union (after `"customer-admin"`):

```ts
  | "customer-admin"
  | "approval"
  | "http"
```

- [ ] **Step 4: Wire the service in `client.ts`**

Add the import (after the `CustomerAdminService` import, line ~55):

```ts
import { ApprovalService } from "./services/approval";
```

Add the readonly field (after `customerAdmin`, line ~102):

```ts
  readonly approvals: ApprovalService;
```

Add the construction (after the `this.customerAdmin = …` line, ~204):

```ts
    this.approvals = new ApprovalService(mk("approval"));
```

- [ ] **Step 5: Add the barrel export in `index.ts`**

Append to `packages/sdk/src/index.ts` (after `export * from "./customer-admin";`):

```ts
export * from "./approval";
```

- [ ] **Step 6: Run it — expect PASS**

```bash
pnpm -F @viu/emporix-sdk test approval-wiring && pnpm -F @viu/emporix-sdk typecheck
```
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/approval-wiring.test.ts
git commit -m "feat(sdk): wire approvals into client + logger + barrel"
```

---

### Task 5: React hooks — `use-approvals.ts`

**Files:**
- Create: `packages/react/src/hooks/use-approvals.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Test: `packages/react/tests/use-approvals.test.tsx`

Build the SDK first so React typechecks against fresh `dist/`:
```bash
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 1: Write the failing hook test**

Create `packages/react/tests/use-approvals.test.tsx` (mirror `use-returns` test
harness — check an existing React test for the exact `renderHook`/provider wrapper +
`createMemoryStorage({ initial: "cust-tok" })` setup and copy it verbatim):

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { waitFor } from "@testing-library/react";
import { useApprovals, useApproval, useCreateApproval, useUpdateApproval } from "../src/hooks/use-approvals";
import { renderEmporixHook } from "./helpers/render-emporix-hook"; // adjust to actual helper

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = "https://api.emporix.io/approval/acme";

describe("approval hooks", () => {
  it("useApprovals queries the list with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/approvals`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "a1" }]);
      }),
    );
    const { result } = renderEmporixHook(() => useApprovals(), { token: "cust-tok" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "a1" }]);
    expect(seenAuth).toBe("Bearer cust-tok");
  });

  it("useApproval is disabled without an id", () => {
    const { result } = renderEmporixHook(() => useApproval(undefined), { token: "cust-tok" });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useCreateApproval posts and resolves the created id", async () => {
    server.use(
      http.post(`${BASE}/approvals`, () => HttpResponse.json({ id: "a1" }, { status: 201 })),
    );
    const { result } = renderEmporixHook(() => useCreateApproval(), { token: "cust-tok" });
    const created = await result.current.mutateAsync({ resource: { resourceType: "CART" } } as never);
    expect(created.id).toBe("a1");
  });

  it("useUpdateApproval patches with a JSON-Patch op-array", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/approvals/a1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderEmporixHook(() => useUpdateApproval(), { token: "cust-tok" });
    await result.current.mutateAsync({
      approvalId: "a1",
      ops: [{ op: "replace", path: "/status", value: "APPROVED" }] as never,
    });
    expect(body).toEqual([{ op: "replace", path: "/status", value: "APPROVED" }]);
  });
});
```

> If the repo's React test helper differs (it does — check `use-returns.test.tsx`),
> copy that file's exact provider/render setup and storage seeding rather than the
> `renderEmporixHook` placeholder above.

- [ ] **Step 2: Run it — expect FAIL** (module not found)

```bash
pnpm -F @viu/emporix-sdk-react test use-approvals
```
Expected: FAIL.

- [ ] **Step 3: Implement the hooks**

Create `packages/react/src/hooks/use-approvals.ts`:

```ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "approvals"] as const;

/** The signed-in customer's approvals (customer-only). */
export function useApprovals(
  opts: { query?: Record<string, string | number> } = {},
): UseQueryResult<ApprovalList> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("approvals", [opts.query ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.approvals.listApprovals(opts.query ?? {}, ctx),
    staleTime: STALE,
  });
}

/** A single approval by id (customer-only). */
export function useApproval(approvalId: string | undefined): UseQueryResult<Approval> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("approvals", [approvalId ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.approvals.getApproval(approvalId as string, ctx),
    enabled: Boolean(approvalId),
    staleTime: STALE,
  });
}

/** Create an approval request for the signed-in customer. Invalidates the list. */
export function useCreateApproval(): UseMutationResult<ApprovalCreated, unknown, ApprovalInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalInput) => client.approvals.createApproval(input, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Variables for {@link useUpdateApproval}. */
export interface UseUpdateApprovalVars {
  approvalId: string;
  /** JSON-Patch op-array — e.g. `[{ op: "replace", path: "/status", value: "APPROVED" }]`. */
  ops: ApprovalPatch;
}

/** Approve/reject/amend an approval via JSON-Patch (customer-only). Invalidates the list. */
export function useUpdateApproval(): UseMutationResult<void, unknown, UseUpdateApprovalVars> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, ops }: UseUpdateApprovalVars) =>
      client.approvals.updateApproval(approvalId, ops, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
```

- [ ] **Step 4: Export from the React barrel**

Append to `packages/react/src/hooks/index.ts`:

```ts
export { useApprovals, useApproval, useCreateApproval, useUpdateApproval } from "./use-approvals";
export type { UseUpdateApprovalVars } from "./use-approvals";
```

- [ ] **Step 5: Run it — expect PASS**

```bash
pnpm -F @viu/emporix-sdk-react test use-approvals && pnpm -F @viu/emporix-sdk-react typecheck
```
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-approvals.ts packages/react/src/hooks/index.ts packages/react/tests/use-approvals.test.tsx
git commit -m "feat(react): add approval hooks"
```

---

### Task 6: Docs + CLAUDE.md + changeset

**Files:**
- Create: `docs/approval.md`
- Modify: `docs/react.md`
- Modify: `CLAUDE.md` (service list, line ~13)
- Create: `.changeset/admin-approval.md`

- [ ] **Step 1: Write `docs/approval.md`**

Cover: customer-token-only model; `client.approvals` method table; the JSON-Patch
approve/reject example (`[{ op: "replace", path: "/status", value: "APPROVED" }]`);
note `checkPermitted` / `searchApprovers` are core-only. Match the structure of an
existing service doc (e.g. `docs/` returns/coupon doc if present).

- [ ] **Step 2: Add the hooks to `docs/react.md`**

Add `useApprovals`, `useApproval`, `useCreateApproval`, `useUpdateApproval` to the
hooks reference (customer-only), next to the returns/reward-points entries.

- [ ] **Step 3: Append `Approval` to the service list in `CLAUDE.md`**

Change the line-13 service list tail `… Catalog, Vendor, PickPack, CustomerAdmin)`
to `… Catalog, Vendor, PickPack, CustomerAdmin, Approval)`.

- [ ] **Step 4: Write the changeset**

Create `.changeset/admin-approval.md`:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Approval Service bindings for B2B cart/quote approval workflows.

Core `client.approvals` (`ApprovalService`): `listApprovals`, `getApproval`,
`createApproval`, `updateApproval` (JSON-Patch approve/reject), `deleteApproval`,
`checkPermitted`, and `searchApprovers`. Every endpoint is customer-token-only.

React: `useApprovals`, `useApproval`, `useCreateApproval`, and `useUpdateApproval`
(customer-only) for B2B approval self-service.
```

- [ ] **Step 5: Commit**

```bash
git add docs/approval.md docs/react.md CLAUDE.md .changeset/admin-approval.md
git commit -m "docs(approval): document approval bindings + changeset"
```

---

### Task 7: Full verification

- [ ] **Step 1: Build both packages, run all tests + typecheck**

```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -r test && pnpm typecheck
```
Expected: all green.

- [ ] **Step 2: Finish the branch**

Use superpowers:finishing-a-development-branch to present options (push/PR — note:
user pushes manually; assistant cannot push).

---

## Self-Review

- **Spec coverage:** all 7 endpoints → Tasks 3; types → Task 2; 4 hooks → Task 5;
  wiring → Task 4; docs/changeset → Task 6. ✓
- **Type consistency:** `ApprovalPatch` used identically in service (`ops: ApprovalPatch`),
  hook vars (`ops: ApprovalPatch`), and tests (op-array). `ApprovalCreated.id` used in
  service test + hook test. ✓
- **Codegen risk:** Task 1 Step 3 pins names before any alias is written; fallbacks
  documented for `UpdateApprovalRequest` non-array and `User` collision. ✓
- **Placeholder scan:** React test helper is explicitly flagged to copy from
  `use-returns.test.tsx` rather than invent. ✓
