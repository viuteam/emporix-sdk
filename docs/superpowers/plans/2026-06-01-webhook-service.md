# Webhook Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix Webhook Service as a single server-side core SDK service, `client.webhooks`, binding all ten endpoints (event-subscription catalog + batch toggle, config CRUD, statistics, dashboard access).

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module re-exports them under stable SDK names. One focused service class wraps the endpoints with the default service (clientCredentials) token like `tenant-config`/`media`, and is wired onto `EmporixClient` exactly like the other services. The 207 batch PATCH returns its per-item result array verbatim — partial failures are surfaced, not thrown.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-webhook-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `webhook` spec URL to the fetch list |
| `packages/sdk/specs/webhook.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/webhook/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/webhook-types.ts` | public types: `WebhookSubscription`, `WebhookSubscriptionUpdateItem`, `WebhookSubscriptionUpdateResultItem`, `WebhookConfig`, `WebhookConfigDraft`, `WebhookConfigPatch`, `WebhookConfigCreated`, `WebhookStatistics`, `WebhookDashboardAccess`, `WebhookStatisticsQuery`, `DeleteConfigOptions` |
| `packages/sdk/src/services/webhook.ts` | `WebhookService` (all 10 endpoints) |
| `packages/sdk/src/webhook.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"webhook"` to the `ServiceName` union |
| `packages/sdk/src/client.ts` | construct + expose `webhooks` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/webhook-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/webhook.test.ts` | MSW tests |
| `packages/sdk/tests/services/webhook-wiring.test.ts` | client wiring test |
| `docs/webhook.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/webhook-service.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

---

## Task 1: Generate Webhook types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/webhook.yml`, `packages/sdk/src/generated/webhook/index.ts`, `packages/sdk/src/generated/webhook/types.gen.ts`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add this line to the `SPECS` object (after the `configuration` entry):

```ts
  webhook: `${BASE}/webhooks/webhook-service/api-reference/api.yml`,
```

(URL verified live → HTTP 200.)

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched webhook (...bytes)` and the generate step prints `generated webhook` (or completes without error and writes `src/generated/webhook/`).

- [ ] **Step 3: Verify the generated type names**

Run:
```bash
grep -nE "export type (WebhookSubscription|WebhookSubscriptionUpdate|WebhookConfig|.*Statistics|.*Dashboard)" packages/sdk/src/generated/webhook/types.gen.ts
```
Expected: matches for the subscription read model, the subscription update item, the per-item update result, the config model, the config create/update bodies, statistics, and dashboard-access. **Record the exact emitted names** — Task 2's alias imports must match them. hey-api commonly suffixes request/response bodies (e.g. `…Data`, `…Response`, or numbered `…1`); pick the schema that matches the shapes in the spec §1:
  - read model with `event`/`subscription`/`excludedFields`/`metadata` → `WebhookSubscription` alias source.
  - write item with `eventType`/`action`/`fieldsToSubscribe` → `WebhookSubscriptionUpdateItem` alias source.
  - 207 element with `eventType`/`code`/`status`/`message` → `WebhookSubscriptionUpdateResultItem` alias source.
  - `{ code, active, provider, configuration }` → `WebhookConfig` alias source; its create/replace body (no `code`/`secretKeyExists`) → `WebhookConfigDraft`; its PATCH body (all-optional) → `WebhookConfigPatch`.
  - statistics response → `WebhookStatistics`; dashboard-access response → `WebhookDashboardAccess`.

If a needed schema is NOT separately emitted (e.g. the 207 element is inlined), define a local interface in Task 2 matching the spec shape instead of aliasing — note which ones in this step.

- [ ] **Step 4: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` also touched other `specs/*.yml` or `src/generated/*` files (upstream drift unrelated to this feature), restore them so this PR stays scoped:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-run Step 2 and immediately stage just the webhook paths in Step 5. (If `git status` showed only the new `webhook` files, skip this step.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/webhook.yml packages/sdk/src/generated/webhook
git commit -m "feat(sdk): generate webhook service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/webhook-types.ts`
- Test: `packages/sdk/tests/services/webhook-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/webhook-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  WebhookSubscription,
  WebhookSubscriptionUpdateItem,
  WebhookSubscriptionUpdateResultItem,
  WebhookConfig,
  WebhookConfigDraft,
  WebhookConfigCreated,
  WebhookStatisticsQuery,
  DeleteConfigOptions,
} from "../../src/services/webhook-types";

describe("webhook types", () => {
  it("WebhookSubscriptionUpdateItem requires eventType", () => {
    const item: WebhookSubscriptionUpdateItem = { eventType: "product.created", action: "SUBSCRIBE" };
    expectTypeOf(item.eventType).toEqualTypeOf<string>();
  });

  it("WebhookSubscriptionUpdateResultItem carries a per-item status", () => {
    expectTypeOf<WebhookSubscriptionUpdateResultItem>().toHaveProperty("eventType");
    expectTypeOf<WebhookSubscriptionUpdateResultItem>().toHaveProperty("status");
  });

  it("WebhookConfigCreated is { code }", () => {
    const c: WebhookConfigCreated = { code: "cfg_1" };
    expectTypeOf(c.code).toEqualTypeOf<string>();
  });

  it("WebhookStatisticsQuery fields are optional YYYY-MM strings", () => {
    const q: WebhookStatisticsQuery = { fromYearMonth: "2026-01" };
    expectTypeOf(q.fromYearMonth).toEqualTypeOf<string | undefined>();
    expectTypeOf(q.toYearMonth).toEqualTypeOf<string | undefined>();
  });

  it("DeleteConfigOptions.force is an optional boolean", () => {
    const o: DeleteConfigOptions = { force: true };
    expectTypeOf(o.force).toEqualTypeOf<boolean | undefined>();
  });

  it("WebhookSubscription / WebhookConfig / WebhookConfigDraft are exported", () => {
    expectTypeOf<WebhookSubscription>().not.toBeNever();
    expectTypeOf<WebhookConfig>().not.toBeNever();
    expectTypeOf<WebhookConfigDraft>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/webhook-types.test.ts`
Expected: FAIL — cannot find module `../../src/services/webhook-types`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/webhook-types.ts`. **Adjust every `import` to the actual generated names recorded in Task 1, Step 3.** The names below are the spec's intended public names; the right-hand side of each alias is the placeholder for the generated source:

```ts
import type {
  WebhookSubscription as GenWebhookSubscription,
  WebhookSubscriptionUpdateItem as GenWebhookSubscriptionUpdateItem,
  WebhookSubscriptionUpdateResult as GenWebhookSubscriptionUpdateResult,
  WebhookConfig as GenWebhookConfig,
  WebhookConfigDraft as GenWebhookConfigDraft,
  WebhookConfigPatch as GenWebhookConfigPatch,
  WebhookStatistics as GenWebhookStatistics,
  WebhookDashboardAccess as GenWebhookDashboardAccess,
} from "../generated/webhook";

/** A webhook event subscription (read model): the event metadata + on/off state. */
export type WebhookSubscription = GenWebhookSubscription;

/** One item of the batch `PATCH /event-subscriptions` body. `eventType` is required. */
export type WebhookSubscriptionUpdateItem = GenWebhookSubscriptionUpdateItem;

/**
 * One element of the **207** result returned by `updateEventSubscriptions`.
 * `status` reflects per-item success/failure — the batch can partially fail.
 */
export type WebhookSubscriptionUpdateResultItem = GenWebhookSubscriptionUpdateResult;

/** A webhook delivery configuration (provider + provider-specific settings). */
export type WebhookConfig = GenWebhookConfig;

/** Body for `createConfig` / `replaceConfig`. `secretKey` is write-only. */
export type WebhookConfigDraft = GenWebhookConfigDraft;

/** Partial body for `patchConfig`. */
export type WebhookConfigPatch = GenWebhookConfigPatch;

/** Response of `createConfig`. */
export interface WebhookConfigCreated {
  code: string;
}

/** Webhook delivery statistics (SVIX_SHARED-oriented). */
export type WebhookStatistics = GenWebhookStatistics;

/** Svix dashboard access (URL / token) returned by `getDashboardAccess`. */
export type WebhookDashboardAccess = GenWebhookDashboardAccess;

/** Query for `getStatistics`. Both bounds are `YYYY-MM`; omitted when absent. */
export interface WebhookStatisticsQuery {
  fromYearMonth?: string;
  toYearMonth?: string;
}

/** Options for `deleteConfig`. */
export interface DeleteConfigOptions {
  /** Required to delete the currently-active config. Serialized as `?force=true`. */
  force?: boolean;
}
```

> If Task 1 found the 207-result element is **inlined** (not a named schema),
> replace its alias with a local interface:
> ```ts
> export interface WebhookSubscriptionUpdateResultItem {
>   eventType: string;
>   code: number;
>   status: string;
>   message?: string;
> }
> ```
> Apply the same fallback to any other schema Task 1 flagged as not separately
> emitted.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/webhook-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/webhook-types.ts packages/sdk/tests/services/webhook-types.test.ts
git commit -m "feat(sdk): add webhook public types"
```

---

## Task 3: WebhookService

**Files:**
- Create: `packages/sdk/src/services/webhook.ts`, `packages/sdk/src/webhook.ts`
- Test: `packages/sdk/tests/services/webhook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/webhook.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { WebhookService } from "../../src/services/webhook";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError, EmporixError } from "../../src/core/errors";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "webhook" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new WebhookService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/webhook/acme";

describe("WebhookService", () => {
  it("listEventSubscriptions GETs the catalog with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/event-subscriptions`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { event: { type: "product.created" }, subscription: "SUBSCRIBED", excludedFields: [] },
        ]);
      }),
    );
    const rows = await svc().listEventSubscriptions();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(rows[0]?.subscription).toBe("SUBSCRIBED");
  });

  it("updateEventSubscriptions PATCHes items and returns the 207 per-item result array", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/event-subscriptions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          [
            { eventType: "product.created", code: 200, status: "OK", message: "subscribed" },
            { eventType: "order.bad", code: 409, status: "CONFLICT", message: "stale version" },
          ],
          { status: 207 },
        );
      }),
    );
    const results = await svc().updateEventSubscriptions([
      { eventType: "product.created", action: "SUBSCRIBE" },
      { eventType: "order.bad", action: "SUBSCRIBE", metadata: { version: 1 } },
    ]);
    expect(body).toEqual([
      { eventType: "product.created", action: "SUBSCRIBE" },
      { eventType: "order.bad", action: "SUBSCRIBE", metadata: { version: 1 } },
    ]);
    // 207 is success — no throw — and partial failures are observable.
    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.code >= 400)).toHaveLength(1);
  });

  it("listConfigs GETs /config", async () => {
    server.use(
      http.get(`${BASE}/config`, () =>
        HttpResponse.json([{ code: "cfg_1", active: true, provider: "SVIX_SHARED", configuration: {} }]),
      ),
    );
    const rows = await svc().listConfigs();
    expect(rows[0]?.code).toBe("cfg_1");
  });

  it("getConfig GETs one config", async () => {
    server.use(
      http.get(`${BASE}/config/cfg_1`, () =>
        HttpResponse.json({ code: "cfg_1", active: true, provider: "HTTP", configuration: { destinationUrl: "https://x", secretKeyExists: true } }),
      ),
    );
    const c = await svc().getConfig("cfg_1");
    expect(c.provider).toBe("HTTP");
  });

  it("getConfig throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/config/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getConfig("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createConfig POSTs the draft and returns { code }", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/config`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: "cfg_new" }, { status: 201 });
      }),
    );
    const created = await svc().createConfig({
      active: true,
      provider: "HTTP",
      configuration: { destinationUrl: "https://x", secretKey: "shh" },
    } as never);
    expect((body as { provider: string }).provider).toBe("HTTP");
    expect(created.code).toBe("cfg_new");
  });

  it("replaceConfig PUTs and resolves to void on 204", async () => {
    server.use(http.put(`${BASE}/config/cfg_1`, () => new HttpResponse(null, { status: 204 })));
    await expect(
      svc().replaceConfig("cfg_1", { active: false, provider: "SVIX_SHARED", configuration: {} } as never),
    ).resolves.toBeUndefined();
  });

  it("patchConfig PATCHes and resolves to void on 204", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/config/cfg_1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().patchConfig("cfg_1", { active: false } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ active: false });
  });

  it("deleteConfig DELETEs with no query by default", async () => {
    let search = "x";
    server.use(
      http.delete(`${BASE}/config/cfg_1`, ({ request }) => {
        search = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteConfig("cfg_1")).resolves.toBeUndefined();
    expect(search).toBe("");
  });

  it("deleteConfig sends ?force=true when force is set", async () => {
    let force: string | null = "x";
    server.use(
      http.delete(`${BASE}/config/cfg_1`, ({ request }) => {
        force = new URL(request.url).searchParams.get("force");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().deleteConfig("cfg_1", { force: true });
    expect(force).toBe("true");
  });

  it("deleteConfig of the active config without force surfaces the 409", async () => {
    server.use(
      http.delete(`${BASE}/config/cfg_active`, () =>
        HttpResponse.json({ status: 409, message: "active config" }, { status: 409 }),
      ),
    );
    await expect(svc().deleteConfig("cfg_active")).rejects.toBeInstanceOf(EmporixError);
  });

  it("getStatistics serializes the YYYY-MM range", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(`${BASE}/statistics`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ total: 0 });
      }),
    );
    await svc().getStatistics({ fromYearMonth: "2026-01", toYearMonth: "2026-03" });
    expect((q as URLSearchParams | null)?.get("fromYearMonth")).toBe("2026-01");
    expect((q as URLSearchParams | null)?.get("toYearMonth")).toBe("2026-03");
  });

  it("getStatistics sends no query when called empty", async () => {
    let search = "x";
    server.use(
      http.get(`${BASE}/statistics`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ total: 0 });
      }),
    );
    await svc().getStatistics();
    expect(search).toBe("");
  });

  it("getDashboardAccess GETs /dashboard-access", async () => {
    server.use(
      http.get(`${BASE}/dashboard-access`, () => HttpResponse.json({ url: "https://app.svix.com/..." })),
    );
    const access = await svc().getDashboardAccess();
    expect(access).toBeTruthy();
  });

  it("encodeURIComponent-escapes the config code in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/webhook/acme/config/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ code: "a/b", active: false, provider: "SVIX_SHARED", configuration: {} });
      }),
    );
    await svc().getConfig("a/b");
    expect(pathname).toBe("/webhook/acme/config/a%2Fb");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/webhook.test.ts`
Expected: FAIL — cannot find module `../../src/services/webhook`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/webhook.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  WebhookSubscription,
  WebhookSubscriptionUpdateItem,
  WebhookSubscriptionUpdateResultItem,
  WebhookConfig,
  WebhookConfigDraft,
  WebhookConfigPatch,
  WebhookConfigCreated,
  WebhookStatistics,
  WebhookDashboardAccess,
  WebhookStatisticsQuery,
  DeleteConfigOptions,
} from "./webhook-types";

export type {
  WebhookSubscription,
  WebhookSubscriptionUpdateItem,
  WebhookSubscriptionUpdateResultItem,
  WebhookConfig,
  WebhookConfigDraft,
  WebhookConfigPatch,
  WebhookConfigCreated,
  WebhookStatistics,
  WebhookDashboardAccess,
  WebhookStatisticsQuery,
  DeleteConfigOptions,
} from "./webhook-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Webhook administration (`/webhook/{tenant}/…`): the event-subscription
 * catalog and batch toggle, delivery-config CRUD, statistics, and Svix
 * dashboard access. Requires the backend-only `webhook.subscription_read` /
 * `webhook.subscription_manage` scopes — default auth: service. Server-side
 * use only; the service token must never reach a browser.
 */
export class WebhookService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/webhook/${this.ctx.tenant}`;
  }

  /** List the event-subscription catalog with each event's on/off state. */
  async listEventSubscriptions(auth: AuthContext = SERVICE): Promise<WebhookSubscription[]> {
    return this.ctx.http.request<WebhookSubscription[]>({
      method: "GET",
      path: `${this.base()}/event-subscriptions`,
      auth,
    });
  }

  /**
   * Batch subscribe/unsubscribe events. Returns the **207** per-item result
   * array verbatim — the batch can partially fail, so inspect each element's
   * `code`/`status` (e.g. `results.filter(r => r.code >= 400)`). Does NOT throw
   * on a 207 with failed items; only a non-2xx HTTP status throws.
   */
  async updateEventSubscriptions(
    items: WebhookSubscriptionUpdateItem[],
    auth: AuthContext = SERVICE,
  ): Promise<WebhookSubscriptionUpdateResultItem[]> {
    return this.ctx.http.request<WebhookSubscriptionUpdateResultItem[]>({
      method: "PATCH",
      path: `${this.base()}/event-subscriptions`,
      auth,
      body: items,
    });
  }

  /** List delivery configurations. */
  async listConfigs(auth: AuthContext = SERVICE): Promise<WebhookConfig[]> {
    return this.ctx.http.request<WebhookConfig[]>({
      method: "GET",
      path: `${this.base()}/config`,
      auth,
    });
  }

  /** Retrieve one delivery configuration by code. */
  async getConfig(code: string, auth: AuthContext = SERVICE): Promise<WebhookConfig> {
    return this.ctx.http.request<WebhookConfig>({
      method: "GET",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /** Create a delivery configuration. Returns the server-assigned `{ code }`. */
  async createConfig(
    draft: WebhookConfigDraft,
    auth: AuthContext = SERVICE,
  ): Promise<WebhookConfigCreated> {
    return this.ctx.http.request<WebhookConfigCreated>({
      method: "POST",
      path: `${this.base()}/config`,
      auth,
      body: draft,
    });
  }

  /** Replace a delivery configuration by code (204). */
  async replaceConfig(
    code: string,
    draft: WebhookConfigDraft,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
      body: draft,
    });
  }

  /** Partially update a delivery configuration by code (204). */
  async patchConfig(
    code: string,
    patch: WebhookConfigPatch,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
      body: patch,
    });
  }

  /**
   * Delete a delivery configuration by code. Pass `{ force: true }` to delete
   * the currently-active config (the server otherwise rejects it).
   */
  async deleteConfig(
    code: string,
    opts: DeleteConfigOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    const query = opts.force === true ? { force: true } : undefined;
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Read delivery statistics over an optional `YYYY-MM` range. */
  async getStatistics(
    query: WebhookStatisticsQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<WebhookStatistics> {
    const q: Record<string, string> = {};
    if (query.fromYearMonth) q.fromYearMonth = query.fromYearMonth;
    if (query.toYearMonth) q.toYearMonth = query.toYearMonth;
    return this.ctx.http.request<WebhookStatistics>({
      method: "GET",
      path: `${this.base()}/statistics`,
      auth,
      ...(Object.keys(q).length > 0 ? { query: q } : {}),
    });
  }

  /** Obtain Svix dashboard access (URL / token). */
  async getDashboardAccess(auth: AuthContext = SERVICE): Promise<WebhookDashboardAccess> {
    return this.ctx.http.request<WebhookDashboardAccess>({
      method: "GET",
      path: `${this.base()}/dashboard-access`,
      auth,
    });
  }
}
```

Create the facade `packages/sdk/src/webhook.ts`:

```ts
export * from "./services/webhook";
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/webhook.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

> If typecheck fails because a generated draft/patch type rejects the test's
> `as never`-cast bodies, that is expected: the `as never` casts in the test
> deliberately bypass the exact generated wire shape (which is not the unit
> under test here — the path/verb/query behavior is). Leave them. If the
> service file itself fails to typecheck against the generated types, the alias
> names in Task 2 are wrong — return to Task 1 Step 3.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/webhook.ts packages/sdk/src/webhook.ts packages/sdk/tests/services/webhook.test.ts
git commit -m "feat(sdk): add webhook service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/webhook-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/webhook-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { WebhookService } from "../../src/services/webhook";

describe("EmporixClient webhook wiring", () => {
  it("exposes the webhooks service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.webhooks).toBeInstanceOf(WebhookService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/webhook-wiring.test.ts`
Expected: FAIL — `sdk.webhooks` is `undefined` (not an instance).

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"webhook"` to the `ServiceName` union (insert before `| "http"`):

```ts
  | "configuration"
  | "webhook"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

In `packages/sdk/src/client.ts`, add the import next to the other service imports (after `ClientConfigService`):

```ts
import { WebhookService } from "./services/webhook";
```

Add the readonly field next to the other service fields (after `clientConfig`):

```ts
  readonly webhooks: WebhookService;
```

Construct it in the constructor next to the other `this.x = new XService(mk(...))` lines (after `this.clientConfig = ...`):

```ts
    this.webhooks = new WebhookService(mk("webhook"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add this line next to the other `export * from "./<facade>"` lines (after `export * from "./client-config";`):

```ts
export * from "./webhook";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/webhook-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/webhook-wiring.test.ts
git commit -m "feat(sdk): expose webhook service on the client"
```

---

## Task 5: Documentation

**Files:**
- Create: `docs/webhook.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/webhook.md`:

````markdown
# Webhook Service

Bindings for the Emporix **Webhook Service** (`/webhook/{tenant}/…`): the
event-subscription catalog, delivery configurations, statistics, and Svix
dashboard access.

> **Server-side only.** Every endpoint requires the backend
> `webhook.subscription_read` / `webhook.subscription_manage` scopes, served by
> the **service (clientCredentials) token**. Never construct these calls from a
> browser — the admin token must not be exposed. Use them in Node, Next.js route
> handlers / server actions, or other trusted backends.

## Event subscriptions — `client.webhooks`

```ts
// list the catalog (each event's on/off state + excluded fields)
const subs = await client.webhooks.listEventSubscriptions();

// batch subscribe/unsubscribe — returns a per-item result (HTTP 207)
const results = await client.webhooks.updateEventSubscriptions([
  { eventType: "product.created", action: "SUBSCRIBE" },
  { eventType: "order.created", action: "UNSUBSCRIBE" },
]);

// 207 is success at the HTTP level. The batch can partially fail —
// inspect each item rather than relying on a thrown error:
const failed = results.filter((r) => r.code >= 400);
if (failed.length) {
  console.warn("some subscriptions failed", failed);
}
```

`metadata.version` on an update item provides optimistic locking; a stale
version surfaces as a per-item failure in the 207 result.

## Delivery configurations

Only **one** configuration may be `active: true` at a time.

```ts
const configs = await client.webhooks.listConfigs();
const cfg = await client.webhooks.getConfig("cfg_1");

// create (returns { code })
const { code } = await client.webhooks.createConfig({
  active: true,
  provider: "HTTP",
  configuration: { destinationUrl: "https://example.com/hooks", secretKey: "whsec_…" },
});

await client.webhooks.replaceConfig(code, { active: true, provider: "SVIX_SHARED", configuration: {} });
await client.webhooks.patchConfig(code, { active: false });

// deleting the *active* config requires force
await client.webhooks.deleteConfig(code);                  // non-active
await client.webhooks.deleteConfig("cfg_active", { force: true }); // active
```

`secretKey` is **write-only**: `getConfig` never returns it, only
`secretKeyExists: boolean`. Re-send `secretKey` only when rotating it.

## Statistics & dashboard

```ts
const stats = await client.webhooks.getStatistics({ fromYearMonth: "2026-01", toYearMonth: "2026-03" });
const access = await client.webhooks.getDashboardAccess();
```

Statistics is oriented around the shared Svix provider (`SVIX_SHARED`).

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row in the workspace-layout table and add `Webhooks` to the parenthesized service list (append before the closing paren, after the last existing service name).

- [ ] **Step 3: Commit**

```bash
git add docs/webhook.md CLAUDE.md
git commit -m "docs(sdk): document the webhook service"
```

---

## Task 6: Changeset

**Files:**
- Create: `.changeset/webhook-service.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/webhook-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add Webhook Service bindings: `client.webhooks` provides the event-subscription
catalog + batch toggle (`listEventSubscriptions` / `updateEventSubscriptions`),
delivery-config CRUD (`listConfigs` / `getConfig` / `createConfig` /
`replaceConfig` / `patchConfig` / `deleteConfig`), `getStatistics`, and
`getDashboardAccess`. `updateEventSubscriptions` returns the HTTP-207 per-item
result array so callers can handle partial failures. Server-side only — these
use the service (clientCredentials) token and must not be called from a browser.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` for a minor bump, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/webhook-service.md
git commit -m "chore(release): add webhook service changeset"
```

---

## Final verification (after all tasks)

- [ ] Run the full package suite + typecheck + lint:
```bash
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk lint
```
- [ ] Build so examples typecheck against the new dist surface:
```bash
pnpm -F @viu/emporix-sdk build
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 all 10 endpoints → Task 3 binds `listEventSubscriptions`, `updateEventSubscriptions`, `listConfigs`, `getConfig`, `createConfig`, `replaceConfig`, `patchConfig`, `deleteConfig`, `getStatistics`, `getDashboardAccess` (10/10). D2 no React → no React tasks. D3 one service `client.webhooks` → Task 4. D4 207 returns per-item array, no throw → `updateEventSubscriptions` returns `WebhookSubscriptionUpdateResultItem[]`; test asserts a 207 with a failed item does not throw and is filterable. D5 `deleteConfig(code, { force? })` → query only when `force === true`; two tests cover present/absent. D6 codegen + thin aliases → Tasks 1+2. D7 service-token default → `const SERVICE` in Task 3, all methods default `auth`. D8 verb-noun names → §3 names used verbatim. Tests §8 → Tasks 2/3/4. Docs/changeset → Tasks 5/6. No gaps.
- **Placeholder scan:** No TBD/TODO. Every code step has full code. The only upstream-dependent uncertainty (generated type names; whether the 207-result element is a named vs inlined schema) is a concrete `grep` verification (Task 1 Step 3) with a defined fallback (local interface in Task 2), not a placeholder.
- **Type consistency:** Public names `WebhookSubscription` / `WebhookSubscriptionUpdateItem` / `WebhookSubscriptionUpdateResultItem` / `WebhookConfig` / `WebhookConfigDraft` / `WebhookConfigPatch` / `WebhookConfigCreated` / `WebhookStatistics` / `WebhookDashboardAccess` / `WebhookStatisticsQuery` / `DeleteConfigOptions` match across Tasks 2→3, the service re-export, and the changeset. Method names match §3 across Task 3, the wiring test (Task 4), the docs (Task 5), and the changeset (Task 6).
- **Pattern fidelity:** `const SERVICE: AuthContext = { kind: "service" }`; `this.ctx.http.request<T>({ method, path, query, body, auth })`; trailing optional `auth = SERVICE`; conditional-query spread (`...(query ? { query } : {})`) — all match `tenant-config.ts` / `media.ts`. Facade is a one-line `export * from "./services/webhook"`. Logger `ServiceName += "webhook"`; client field via `mk("webhook")`; index re-export of the facade — all match the configuration-service precedent. MSW harness (oauth/token → `svc-tok`, assert `Bearer svc-tok`) mirrors `tenant-config.test.ts`.
- **207-as-success correctness:** verified against `packages/sdk/src/core/http.ts` — `request<T>` returns the parsed body whenever `res.ok` (true for all 2xx incl. 207); it only throws on 401/non-2xx. So `updateEventSubscriptions` returns the parsed 207 array with no special-casing, exactly as the spec requires.
```
