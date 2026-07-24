# Invoice & Quote facades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `InvoiceService` (`client.invoices`) and `QuoteService` (`client.quotes`, with a `reasons` sub-resource) backed by the generated `invoice` / `quote` types. oauth-service gets **no** facade (the token grant is owned by the auth core).

**Architecture:** Hand-written service facades over `ctx.http.request`, types aliased from `src/generated/{invoice,quote}`. Quote reasons are a lazily-instantiated `QuoteReasonsResource` exposed as `client.quotes.reasons`. Wiring: `ServiceName` union → `client.ts` registration → `index.ts` re-export. No new subpath export (consistent with schema/ai/site).

**Tech Stack:** TypeScript, Vitest + MSW.

## Global Constraints

- Branch `feat/invoice-quote-facades`, off `chore/register-missing-api-specs` (PR #155). Do not rebase onto main until #155 merges.
- HTTP: `this.ctx.http.request<T>({ method, path, auth, query?, body? })`. Binary responses use `this.ctx.http.requestRaw(o): Promise<Response>` (does NOT map non-2xx to typed errors — check `res.ok` and throw `errorFromResponse`).
- Auth defaults: invoice → `{ kind: "service" }`; quote methods → `{ kind: "anonymous" }` (customer-first via docs/examples); quote-reason reads → `{ kind: "anonymous" }`, mutations → `{ kind: "service" }`.
- `PATCH /quotes/{id}` and `PUT /quote-reasons/{id}` both return **204** → facade returns `Promise<void>`.
- List methods wrap the array in `PaginatedItems<T>` (`{ items, pageNumber, pageSize, hasNextPage: items.length === pageSize }`), mirroring `SchemaService.listSchemas`. Defaults `pageNumber: 1`, `pageSize: 60`.
- Verify per task: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run <files>`.
- Commit scope `sdk` (code) / `docs` (docs). First word after scope is a lowercase verb.

## File Structure

- Create `packages/sdk/src/services/invoice-types.ts`, `packages/sdk/src/services/invoice.ts`.
- Create `packages/sdk/src/services/quote-types.ts`, `packages/sdk/src/services/quote.ts` (contains `QuoteService` + `QuoteReasonsResource`).
- Modify `packages/sdk/src/core/logger.ts` (`ServiceName` union), `packages/sdk/src/client.ts` (register), `packages/sdk/src/index.ts` (re-export).
- Tests under `packages/sdk/tests/services/`: `invoice.test.ts`, `quote.test.ts`, `quote-reasons.test.ts`, plus type tests `invoice-types.test.ts`, `quote-types.test.ts`.
- Docs: `docs/invoice.md`, `docs/quote.md`, changelog note, changeset.

**Shared test harness** (copy into each test file; change the `describe`/handlers):

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ctx(channel: string) {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: channel as never });
  const http = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return { tenant: "acme", http, tokenProvider, logger };
}

const BASE = "https://api.emporix.io";
```

---

## Task 1: InvoiceService

**Files:**
- Create: `packages/sdk/src/services/invoice-types.ts`, `packages/sdk/src/services/invoice.ts`
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/invoice.test.ts`, `packages/sdk/tests/services/invoice-types.test.ts`

**Interfaces:**
- Produces: `InvoiceService` (`channel = "invoice"`) with `createJob(draft, auth?)`, `getJob(jobId, auth?)`. Types `InvoiceJobDraft`, `InvoiceJobCreated`, `InvoiceJob`. Client getter `client.invoices`.

- [ ] **Step 1: Create `invoice-types.ts`**

```ts
import type {
  JobRequest as GenJobRequest,
  JobCreationResponse as GenJobCreated,
  JobStatusResponse as GenJobStatus,
} from "../generated/invoice";

/** Input for {@link InvoiceService.createJob} — order ids + job type. */
export type InvoiceJobDraft = GenJobRequest;
/** Result of creating an invoice job — `{ jobId? }`. */
export type InvoiceJobCreated = GenJobCreated;
/** Status of an invoice job + per-order results. */
export type InvoiceJob = GenJobStatus;
```

- [ ] **Step 2: Create `invoice.ts`**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { InvoiceJobDraft, InvoiceJobCreated, InvoiceJob } from "./invoice-types";

export type { InvoiceJobDraft, InvoiceJobCreated, InvoiceJob } from "./invoice-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Invoice Service (`/invoice/{tenant}/…`): create invoice-generation jobs and
 * poll their status. Backend-only — default auth: service.
 */
export class InvoiceService {
  static readonly channel = "invoice" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/invoice/${this.ctx.tenant}/jobs/invoices`;
  }

  /** Create an invoice-generation job (`POST …/jobs/invoices`, 201). */
  async createJob(draft: InvoiceJobDraft, auth: AuthContext = SERVICE): Promise<InvoiceJobCreated> {
    return this.ctx.http.request<InvoiceJobCreated>({
      method: "POST",
      path: this.base(),
      auth,
      body: draft,
    });
  }

  /** Retrieve a job and its per-order results (`GET …/jobs/invoices/{jobId}`). */
  async getJob(jobId: string, auth: AuthContext = SERVICE): Promise<InvoiceJob> {
    return this.ctx.http.request<InvoiceJob>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(jobId)}`,
      auth,
    });
  }
}
```

- [ ] **Step 3: Wire `"invoice"` into `ServiceName`** — in `core/logger.ts`, add `| "invoice"` to the `ServiceName` union.

- [ ] **Step 4: Register in `client.ts`** — add `import { InvoiceService } from "./services/invoice";`; add a `readonly invoices: InvoiceService;` field declaration (next to the other `readonly` service fields); add in the constructor (next to the others): `this.invoices = new InvoiceService(mk(InvoiceService.channel));`

- [ ] **Step 5: Re-export from `index.ts`** — add:

```ts
export { InvoiceService } from "./services/invoice";
export type { InvoiceJobDraft, InvoiceJobCreated, InvoiceJob } from "./services/invoice";
```

- [ ] **Step 6: Write `invoice.test.ts`** (harness, then)

```ts
import { InvoiceService } from "../../src/services/invoice";

describe("InvoiceService", () => {
  it("createJob POSTs the draft and returns { jobId } (201)", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/invoice/acme/jobs/invoices`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ jobId: "job-1" }, { status: 201 });
      }),
    );
    const svc = new InvoiceService(ctx("invoice"));
    const res = await svc.createJob({ jobType: "MANUAL", orderIds: ["o1", "o2"] });
    expect(res).toEqual({ jobId: "job-1" });
    expect(body).toEqual({ jobType: "MANUAL", orderIds: ["o1", "o2"] });
  });

  it("getJob GETs the job by id", async () => {
    server.use(
      http.get(`${BASE}/invoice/acme/jobs/invoices/job-1`, () =>
        HttpResponse.json({ jobStatus: "DONE", jobType: "MANUAL", orders: [{ orderId: "o1", orderStatus: "SUCCESS" }] }),
      ),
    );
    const svc = new InvoiceService(ctx("invoice"));
    const res = await svc.getJob("job-1");
    expect(res.jobStatus).toBe("DONE");
    expect(res.orders?.[0]?.orderId).toBe("o1");
  });
});
```

- [ ] **Step 7: Write `invoice-types.test.ts`**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { InvoiceJobDraft, InvoiceJobCreated, InvoiceJob } from "../../src/services/invoice-types";

describe("invoice types", () => {
  it("aliases the generated invoice types", () => {
    expectTypeOf<InvoiceJobDraft["jobType"]>().toEqualTypeOf<"AUTOMATIC" | "MANUAL">();
    expectTypeOf<InvoiceJobCreated>().not.toBeNever();
    expectTypeOf<InvoiceJob>().not.toBeNever();
  });
});
```

- [ ] **Step 8: Verify** — `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/invoice.test.ts tests/services/invoice-types.test.ts`
Expected: typecheck clean; 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/invoice.ts packages/sdk/src/services/invoice-types.ts packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/invoice.test.ts packages/sdk/tests/services/invoice-types.test.ts
git commit -m "feat(sdk): add InvoiceService (client.invoices)"
```

---

## Task 2: QuoteService — types + quotes CRUD

**Files:**
- Create: `packages/sdk/src/services/quote-types.ts`, `packages/sdk/src/services/quote.ts`
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/quote.test.ts`, `packages/sdk/tests/services/quote-types.test.ts`

**Interfaces:**
- Consumes: `PaginatedItems` from `../core/context`.
- Produces: `QuoteService` (`channel = "quote"`) with `list`, `create`, `get`, `update`, `delete`, `history`, `generatePdf`, and a `reasons` getter (implemented in Task 3). Types listed in Step 1. Client getter `client.quotes`.

- [ ] **Step 1: Create `quote-types.ts`**

```ts
import type {
  QuoteResponse as GenQuote,
  QuoteCreateRequest as GenQuoteCreate,
  QuoteCreateFromCartRequest as GenQuoteCreateFromCart,
  QuoteIdResponse as GenQuoteCreated,
  QuoteUpdateRequest as GenQuoteUpdate,
  QuoteHistory as GenQuoteHistory,
  QuoteReasonResponse as GenQuoteReason,
  QuoteReasonCreateRequest as GenQuoteReasonDraft,
  QuoteReasonUpdateRequest as GenQuoteReasonUpdate,
  QuoteReasonIdResponse as GenQuoteReasonCreated,
} from "../generated/quote";

/** A quote (read shape). */
export type Quote = GenQuote;
/** Body for {@link QuoteService.create} — a from-scratch quote or a from-cart quote. */
export type QuoteDraft = GenQuoteCreate | GenQuoteCreateFromCart;
/** Result of creating a quote — `{ id? }`. */
export type QuoteCreated = GenQuoteCreated;
/** Body for {@link QuoteService.update} — the upstream update-op array. */
export type QuoteUpdate = GenQuoteUpdate;
/** A quote's change history. */
export type QuoteHistory = GenQuoteHistory;

/** A quote reason (read shape). */
export type QuoteReason = GenQuoteReason;
/** Body for `reasons.create`. */
export type QuoteReasonDraft = GenQuoteReasonDraft;
/** Body for `reasons.update` (`metadata.version` required for optimistic locking). */
export type QuoteReasonUpdate = GenQuoteReasonUpdate;
/** Result of creating a quote reason — `{ id? }`. */
export type QuoteReasonCreated = GenQuoteReasonCreated;

/** Filter/pagination for {@link QuoteService.list}. */
export interface ListQuotesQuery {
  /** Emporix `q`-syntax filter. */
  q?: string;
  /** Sort spec (e.g. `createdAt:desc`). */
  sort?: string;
  pageNumber?: number;
  pageSize?: number;
}

/** Pagination for `reasons.list`. */
export interface ListQuoteReasonsQuery {
  pageNumber?: number;
  pageSize?: number;
}
```

- [ ] **Step 2: Create `quote.ts` (QuoteService with quotes CRUD; `reasons` getter stub added in Task 3)**

```ts
import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import { errorFromResponse } from "../core/errors";
import type {
  Quote, QuoteDraft, QuoteCreated, QuoteUpdate, QuoteHistory, ListQuotesQuery,
} from "./quote-types";

export type {
  Quote, QuoteDraft, QuoteCreated, QuoteUpdate, QuoteHistory, ListQuotesQuery,
  QuoteReason, QuoteReasonDraft, QuoteReasonUpdate, QuoteReasonCreated, ListQuoteReasonsQuery,
} from "./quote-types";

const ANON: AuthContext = { kind: "anonymous" };

/**
 * Quote Service (`/quote/{tenant}/…`): B2B quotes and quote reasons. Quotes are
 * customer-owned — pass `auth.customer(token)`; `delete` and reason mutations
 * need the admin `quote.quote_manage` scope. Default auth: anonymous (the SDK
 * convention; supply a token per call).
 */
export class QuoteService {
  static readonly channel = "quote" as const;
  constructor(private readonly ctx: ClientContext) {}

  private quotesBase(): string {
    return `/quote/${this.ctx.tenant}/quotes`;
  }

  /** List quotes, wrapped in {@link PaginatedItems}. */
  async list(query: ListQuotesQuery = {}, auth: AuthContext = ANON): Promise<PaginatedItems<Quote>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const q: Record<string, string | number> = { pageNumber, pageSize };
    if (query.q) q.q = query.q;
    if (query.sort) q.sort = query.sort;
    const items = await this.ctx.http.request<Quote[]>({
      method: "GET", path: this.quotesBase(), auth, query: q,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Create a quote (`POST /quotes`, 201). */
  async create(draft: QuoteDraft, auth: AuthContext = ANON): Promise<QuoteCreated> {
    return this.ctx.http.request<QuoteCreated>({
      method: "POST", path: this.quotesBase(), auth, body: draft,
    });
  }

  /** Retrieve one quote by id. */
  async get(quoteId: string, auth: AuthContext = ANON): Promise<Quote> {
    return this.ctx.http.request<Quote>({
      method: "GET", path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}`, auth,
    });
  }

  /** Apply an update-op array to a quote (`PATCH /quotes/{id}`, 204). */
  async update(quoteId: string, update: QuoteUpdate, auth: AuthContext = ANON): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH", path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}`, auth, body: update,
    });
  }

  /** Delete a quote (`DELETE /quotes/{id}`). Requires the admin `quote_manage` scope. */
  async delete(quoteId: string, auth: AuthContext = ANON): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}`, auth,
    });
  }

  /** Retrieve a quote's change history (`GET /quotes/{id}/history`). */
  async history(quoteId: string, auth: AuthContext = ANON): Promise<QuoteHistory> {
    return this.ctx.http.request<QuoteHistory>({
      method: "GET", path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}/history`, auth,
    });
  }

  /**
   * Generate a quote PDF (`POST /quotes/{id}/pdf`). Returns the raw PDF bytes.
   * Uses `requestRaw` (no typed-error mapping) — a non-2xx is thrown explicitly.
   */
  async generatePdf(quoteId: string, auth: AuthContext = ANON): Promise<Blob> {
    const path = `${this.quotesBase()}/${encodeURIComponent(quoteId)}/pdf`;
    const res = await this.ctx.http.requestRaw({ method: "POST", path, auth });
    if (!res.ok) {
      const body = await res.text();
      throw errorFromResponse(res.status, `POST ${path} failed: ${res.status}`, body);
    }
    return await res.blob();
  }
}
```

Note: `errorFromResponse(status: number, message: string, body: unknown): EmporixError` is **synchronous** (confirmed in `core/errors.ts`) — pass `res.status`, a message, and the read body text. Keep the `!res.ok` guard because `requestRaw` does not map non-2xx to typed errors.

- [ ] **Step 3: Wire `"quote"` into `ServiceName`** (`core/logger.ts`), register `readonly quotes: QuoteService` + `this.quotes = new QuoteService(mk(QuoteService.channel));` in `client.ts`, and re-export from `index.ts`:

```ts
export { QuoteService } from "./services/quote";
export type {
  Quote, QuoteDraft, QuoteCreated, QuoteUpdate, QuoteHistory, ListQuotesQuery,
  QuoteReason, QuoteReasonDraft, QuoteReasonUpdate, QuoteReasonCreated, ListQuoteReasonsQuery,
} from "./services/quote";
```

- [ ] **Step 4: Write `quote.test.ts`** (harness, then)

```ts
import { QuoteService } from "../../src/services/quote";
import { auth } from "../../src/core/auth";

describe("QuoteService", () => {
  it("list wraps the array in PaginatedItems and forwards q/paging with a customer token", async () => {
    let url: URL | null = null;
    let authz: string | null = null;
    server.use(
      http.get(`${BASE}/quote/acme/quotes`, ({ request }) => {
        url = new URL(request.url); authz = request.headers.get("authorization");
        return HttpResponse.json([{ id: "q1" }]);
      }),
    );
    const svc = new QuoteService(ctx("quote"));
    const page = await svc.list({ q: "state:OPEN", pageSize: 10 }, auth.customer("cust-tok"));
    expect(page.items).toEqual([{ id: "q1" }]);
    expect(page.hasNextPage).toBe(false);
    expect(url!.searchParams.get("q")).toBe("state:OPEN");
    expect(url!.searchParams.get("pageSize")).toBe("10");
    expect(authz).toBe("Bearer cust-tok");
  });

  it("create returns { id } (201)", async () => {
    server.use(http.post(`${BASE}/quote/acme/quotes`, () => HttpResponse.json({ id: "q1" }, { status: 201 })));
    const svc = new QuoteService(ctx("quote"));
    const res = await svc.create({ customerId: "c1" } as never, auth.customer("t"));
    expect(res).toEqual({ id: "q1" });
  });

  it("update PATCHes the op array and resolves void on 204", async () => {
    let body: unknown = null;
    server.use(http.patch(`${BASE}/quote/acme/quotes/q1`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }));
    const svc = new QuoteService(ctx("quote"));
    await expect(svc.update("q1", [{ op: "status", value: "APPROVED" }] as never, auth.customer("t"))).resolves.toBeUndefined();
    expect(Array.isArray(body)).toBe(true);
  });

  it("get / history / delete hit the right paths", async () => {
    server.use(
      http.get(`${BASE}/quote/acme/quotes/q1`, () => HttpResponse.json({ id: "q1" })),
      http.get(`${BASE}/quote/acme/quotes/q1/history`, () => HttpResponse.json([{ changedAt: "t" }])),
      http.delete(`${BASE}/quote/acme/quotes/q1`, () => new HttpResponse(null, { status: 204 })),
    );
    const svc = new QuoteService(ctx("quote"));
    expect((await svc.get("q1", auth.customer("t"))).id).toBe("q1");
    expect(await svc.history("q1", auth.customer("t"))).toHaveLength(1);
    await expect(svc.delete("q1", auth.service())).resolves.toBeUndefined();
  });

  it("generatePdf returns a Blob and throws on non-2xx", async () => {
    const svc = new QuoteService(ctx("quote"));
    server.use(http.post(`${BASE}/quote/acme/quotes/q1/pdf`, () =>
      new HttpResponse(new Blob(["%PDF-1.4"]), { status: 200, headers: { "Content-Type": "application/pdf" } })));
    const blob = await svc.generatePdf("q1", auth.customer("t"));
    expect(blob).toBeInstanceOf(Blob);

    server.use(http.post(`${BASE}/quote/acme/quotes/q1/pdf`, () =>
      HttpResponse.json({ message: "nope" }, { status: 403 })));
    await expect(svc.generatePdf("q1", auth.customer("t"))).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 5: Write `quote-types.test.ts`**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Quote, QuoteDraft, QuoteCreated, QuoteUpdate, ListQuotesQuery } from "../../src/services/quote-types";

describe("quote types", () => {
  it("aliases the generated quote types", () => {
    expectTypeOf<Quote>().not.toBeNever();
    expectTypeOf<QuoteDraft>().not.toBeNever();
    expectTypeOf<QuoteCreated>().not.toBeNever();
    expectTypeOf<QuoteUpdate>().not.toBeNever();
    expectTypeOf<ListQuotesQuery["pageSize"]>().toEqualTypeOf<number | undefined>();
  });
});
```

- [ ] **Step 6: Verify** — `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/quote.test.ts tests/services/quote-types.test.ts`
Expected: typecheck clean; tests pass. (If `errorFromResponse` is async/sync-mismatched, fix per its real signature.)

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/quote.ts packages/sdk/src/services/quote-types.ts packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/quote.test.ts packages/sdk/tests/services/quote-types.test.ts
git commit -m "feat(sdk): add QuoteService quotes CRUD (client.quotes)"
```

---

## Task 3: Quote reasons sub-resource

**Files:**
- Modify: `packages/sdk/src/services/quote.ts`
- Test: `packages/sdk/tests/services/quote-reasons.test.ts`

**Interfaces:**
- Consumes: `QuoteReason`, `QuoteReasonDraft`, `QuoteReasonUpdate`, `QuoteReasonCreated`, `ListQuoteReasonsQuery` (Task 2 types).
- Produces: `QuoteReasonsResource` with `list`, `get`, `create`, `update`, `delete`; `QuoteService.reasons` lazy getter.

- [ ] **Step 1: Add `QuoteReasonsResource` to `quote.ts`** (below `QuoteService`)

```ts
const SERVICE: AuthContext = { kind: "service" };

/**
 * Quote reasons (`/quote/{tenant}/quote-reasons`). Config data: reads default
 * anonymous (a storefront may list options); mutations need the admin
 * `quote.quote_manage` scope and default to the service token.
 */
export class QuoteReasonsResource {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/quote/${this.ctx.tenant}/quote-reasons`;
  }

  async list(query: ListQuoteReasonsQuery = {}, auth: AuthContext = ANON): Promise<PaginatedItems<QuoteReason>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const items = await this.ctx.http.request<QuoteReason[]>({
      method: "GET", path: this.base(), auth, query: { pageNumber, pageSize },
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  async get(reasonId: string, auth: AuthContext = ANON): Promise<QuoteReason> {
    return this.ctx.http.request<QuoteReason>({
      method: "GET", path: `${this.base()}/${encodeURIComponent(reasonId)}`, auth,
    });
  }

  async create(draft: QuoteReasonDraft, auth: AuthContext = SERVICE): Promise<QuoteReasonCreated> {
    return this.ctx.http.request<QuoteReasonCreated>({
      method: "POST", path: this.base(), auth, body: draft,
    });
  }

  /** Replace a reason (`PUT`, 204). `draft.metadata.version` is required. */
  async update(reasonId: string, draft: QuoteReasonUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT", path: `${this.base()}/${encodeURIComponent(reasonId)}`, auth, body: draft,
    });
  }

  /** Delete a reason. Requires the admin `quote_manage` scope. */
  async delete(reasonId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `${this.base()}/${encodeURIComponent(reasonId)}`, auth,
    });
  }
}
```

Add the imports `QuoteReason, QuoteReasonDraft, QuoteReasonUpdate, QuoteReasonCreated, ListQuoteReasonsQuery` to the existing `import type { … } from "./quote-types"` at the top of `quote.ts`.

- [ ] **Step 2: Add the `reasons` getter to `QuoteService`** (inside the class)

```ts
  private _reasons?: QuoteReasonsResource;
  /** Quote reasons config (`/quote-reasons`). CRUD sub-resource. */
  get reasons(): QuoteReasonsResource {
    return (this._reasons ??= new QuoteReasonsResource(this.ctx));
  }
```

- [ ] **Step 3: Write `quote-reasons.test.ts`** (harness, then)

```ts
import { QuoteService } from "../../src/services/quote";
import { auth } from "../../src/core/auth";

describe("QuoteService.reasons", () => {
  it("lists reasons (PaginatedItems) with anonymous default", async () => {
    server.use(http.get(`${BASE}/quote/acme/quote-reasons`, () => HttpResponse.json([{ id: "r1", type: "DECLINE" }])));
    const svc = new QuoteService(ctx("quote"));
    const page = await svc.reasons.list();
    expect(page.items).toEqual([{ id: "r1", type: "DECLINE" }]);
  });

  it("create POSTs the draft (201) with the service token by default", async () => {
    let authz: string | null = null;
    server.use(http.post(`${BASE}/quote/acme/quote-reasons`, ({ request }) => {
      authz = request.headers.get("authorization");
      return HttpResponse.json({ id: "r1" }, { status: 201 });
    }));
    const svc = new QuoteService(ctx("quote"));
    const res = await svc.reasons.create({ type: "DECLINE", code: "OUT_OF_STOCK", message: { en: "Out of stock" } });
    expect(res).toEqual({ id: "r1" });
    expect(authz).toBe("Bearer svc-tok");
  });

  it("update PUTs (204) and delete resolves void", async () => {
    server.use(
      http.put(`${BASE}/quote/acme/quote-reasons/r1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/quote/acme/quote-reasons/r1`, () => new HttpResponse(null, { status: 204 })),
    );
    const svc = new QuoteService(ctx("quote"));
    await expect(svc.reasons.update("r1", { type: "CHANGE", code: "X", message: { en: "x" }, metadata: { version: 2 } })).resolves.toBeUndefined();
    await expect(svc.reasons.delete("r1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Verify** — `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/quote-reasons.test.ts tests/services/quote.test.ts`
Expected: typecheck clean; tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/quote.ts packages/sdk/tests/services/quote-reasons.test.ts
git commit -m "feat(sdk): add quote reasons sub-resource (client.quotes.reasons)"
```

---

## Task 4: Docs, changelog, changeset, full verification

**Files:**
- Create: `docs/invoice.md`, `docs/quote.md`, `.changeset/invoice-quote-facades.md`
- Modify: `docs/emporix-upstream-changelog.md`

- [ ] **Step 1: Write `docs/invoice.md`** — server-side-only note; `createJob` / `getJob` usage; the AUTOMATIC vs MANUAL job type; polling `jobStatus` until `DONE`.

- [ ] **Step 2: Write `docs/quote.md`** — customer-first auth note (pass `auth.customer(token)`; `delete` + reason mutations need `quote_manage`); quotes CRUD + `generatePdf` (returns a `Blob`) + `history`; `client.quotes.reasons` CRUD.

- [ ] **Step 3: Add a changelog note** to `docs/emporix-upstream-changelog.md` under the 2026-07-24 section: `client.invoices` and `client.quotes` (+ `client.quotes.reasons`) added; **oauth-service intentionally not wrapped** (token grant owned by the auth core).

- [ ] **Step 4: Create `.changeset/invoice-quote-facades.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Add `client.invoices` (invoice-generation jobs) and `client.quotes` (B2B quotes
CRUD + PDF + history, with a `client.quotes.reasons` config sub-resource),
backed by the generated `invoice` / `quote` types. The OAuth Service is
intentionally not wrapped — its token grant is owned by the SDK auth core.
```

- [ ] **Step 5: Full verification** — `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build && pnpm check:treeshake`
Expected: typecheck clean, all tests pass, build writes `dist/`, treeshake check still passes (invoices/quotes not pulled into the base bundle).

- [ ] **Step 6: Repo-wide typecheck** — `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build && pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add docs/invoice.md docs/quote.md docs/emporix-upstream-changelog.md .changeset/invoice-quote-facades.md
git commit -m "docs(sdk): document invoice/quote facades + changeset"
```

## Self-Review

- **Spec coverage:** invoice (Task 1), quote CRUD + PDF + history (Task 2), quote reasons (Task 3), docs/changeset (Task 4). oauth-service intentionally excluded (documented). All spec sections covered.
- **Type consistency:** `Quote`/`QuoteReason` families defined once in `quote-types.ts`, consumed by `QuoteService` + `QuoteReasonsResource`; `update` methods return `void` (204); `PaginatedItems` wrapping matches `SchemaService`.
- **Wiring:** every new service touches `ServiceName` (logger), `client.ts` (field + constructor), `index.ts` (re-export); no subpath export (matches schema/ai/site).
- **Open verification point flagged for the implementer:** confirm the `QuoteUpdate` op fixtures (`[{ op: "status", value: … }]`) against the real `QuoteUpdateRequest` union at implementation — the tests are the guard. (`errorFromResponse` signature already confirmed: `(status, message, body)`, synchronous.)
```
