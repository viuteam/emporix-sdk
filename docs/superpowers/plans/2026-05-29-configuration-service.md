# Configuration Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full CRUD bindings for the Emporix Configuration Service as two server-side core SDK services, `client.tenantConfig` and `client.clientConfig`.

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module overlays a generic `value` type. Two focused service classes mirror the two API groups (tenant-wide vs per-client), both defaulting to the service (clientCredentials) token like `price`/`media`. They are wired onto `EmporixClient` exactly like the other services.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-29-configuration-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `configuration` spec URL to the fetch list |
| `packages/sdk/specs/configuration.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/configuration/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/configuration-types.ts` | public types: `Configuration<T>`, `ClientConfiguration<T>`, `ConfigurationDraft<T>`, `ListConfigOptions` |
| `packages/sdk/src/services/tenant-config.ts` | `TenantConfigService` (CRUD on `/configurations`) |
| `packages/sdk/src/services/client-config.ts` | `ClientConfigService` (CRUD on `/clients/{client}/configurations`) |
| `packages/sdk/src/tenant-config.ts` | one-line facade re-export |
| `packages/sdk/src/client-config.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"configuration"` to the `ServiceName` union |
| `packages/sdk/src/client.ts` | construct + expose `tenantConfig` / `clientConfig` |
| `packages/sdk/src/index.ts` | re-export the two facades |
| `packages/sdk/tests/services/configuration-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/tenant-config.test.ts` | MSW tests |
| `packages/sdk/tests/services/client-config.test.ts` | MSW tests |
| `packages/sdk/tests/services/configuration-wiring.test.ts` | client wiring test |
| `docs/configuration.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/configuration-services.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

---

## Task 1: Generate Configuration types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/configuration.yml`, `packages/sdk/src/generated/configuration/index.ts`, `packages/sdk/src/generated/configuration/types.gen.ts`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add this line to the `SPECS` object (after the `"customer-segment"` entry):

```ts
  configuration: `${BASE}/configuration/configuration-service/api-reference/api.yml`,
```

(URL verified live → HTTP 200.)

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched configuration (...bytes)` and `generated configuration`.

- [ ] **Step 3: Verify the generated type names**

Run:
```bash
grep -nE "export type (BaseConfiguration|Configuration|ClientConfiguration)\b" packages/sdk/src/generated/configuration/types.gen.ts
```
Expected: matches for `BaseConfiguration` (and likely `Configuration`, `ClientConfiguration`). **`BaseConfiguration` is the only one Task 2 depends on.** If hey-api emitted a different name for it, note the actual name — Task 2's import must match it.

- [ ] **Step 4: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` also touched other `specs/*.yml` or `src/generated/*` files (upstream drift unrelated to this feature), restore them so this PR stays scoped:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-checkout ONLY the configuration outputs if the restore removed them — re-run Step 2 and immediately stage just the configuration paths in Step 5. (If `git status` showed only the new `configuration` files, skip this step.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/configuration.yml packages/sdk/src/generated/configuration
git commit -m "feat(sdk): generate configuration service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/configuration-types.ts`
- Test: `packages/sdk/tests/services/configuration-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/configuration-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Configuration,
  ClientConfiguration,
  ConfigurationDraft,
  ListConfigOptions,
} from "../../src/services/configuration-types";

describe("configuration types", () => {
  it("Configuration<T> types value as T and keeps the base flags", () => {
    const c: Configuration<{ a: number }> = { key: "k", value: { a: 1 }, secured: false };
    expectTypeOf(c.value).toEqualTypeOf<{ a: number }>();
    expectTypeOf(c.secured).toEqualTypeOf<boolean | undefined>();
  });

  it("ClientConfiguration adds _id and client", () => {
    const c: ClientConfiguration<string> = { key: "k", value: "v", _id: "client_k", client: "client" };
    expectTypeOf(c._id).toEqualTypeOf<string>();
    expectTypeOf(c.client).toEqualTypeOf<string>();
  });

  it("ConfigurationDraft has key/value and omits _id/version", () => {
    const d: ConfigurationDraft = { key: "k", value: true };
    expectTypeOf(d).not.toHaveProperty("_id");
    expectTypeOf(d).not.toHaveProperty("version");
  });

  it("ListConfigOptions.keys is string[]", () => {
    const o: ListConfigOptions = { keys: ["a", "b"] };
    expectTypeOf(o.keys).toEqualTypeOf<string[] | undefined>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/configuration-types.test.ts`
Expected: FAIL — cannot find module `../../src/services/configuration-types`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/configuration-types.ts`:

```ts
import type { BaseConfiguration } from "../generated/configuration";

/**
 * A tenant configuration entry. The wire `value` is "any JSON"; the SDK
 * lets callers pin it with a generic (defaults to `unknown`). All other
 * fields mirror the upstream `BaseConfiguration` schema.
 */
export type Configuration<T = unknown> = Omit<BaseConfiguration, "value"> & { value: T };

/** A per-client configuration entry; adds the server-assigned `_id` and `client`. */
export type ClientConfiguration<T = unknown> = Configuration<T> & { _id: string; client: string };

/** Input for create/update. Omits server-managed fields (`version`, `_id`). */
export interface ConfigurationDraft<T = unknown> {
  key: string;
  value: T;
  description?: string;
  /** Encrypts a string `value` at rest. */
  secured?: boolean;
  /** When true, the entry cannot be deleted. Cannot be unset once true. */
  restricted?: boolean;
  /** When true, the entry cannot be updated. */
  readOnly?: boolean;
  /** URL of a JSON Schema used to validate `value`. Immutable once set. */
  schemaUrl?: string;
}

/** Options for the list endpoints. `keys` is serialized to a CSV query param. */
export interface ListConfigOptions {
  keys?: string[];
}
```

If Task 1, Step 3 reported a different name for the base schema type, change the import accordingly (e.g. `import type { Configuration as BaseConfiguration } from "../generated/configuration";`).

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/configuration-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/configuration-types.ts packages/sdk/tests/services/configuration-types.test.ts
git commit -m "feat(sdk): add configuration public types"
```

---

## Task 3: TenantConfigService

**Files:**
- Create: `packages/sdk/src/services/tenant-config.ts`, `packages/sdk/src/tenant-config.ts`
- Test: `packages/sdk/tests/services/tenant-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/tenant-config.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { TenantConfigService } from "../../src/services/tenant-config";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "configuration" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new TenantConfigService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/configuration/acme/configurations";

describe("TenantConfigService", () => {
  it("list GETs all configurations with a service token and no query", async () => {
    let seenAuth: string | null = null;
    let seenSearch = "x";
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        seenSearch = new URL(request.url).search;
        return HttpResponse.json([
          { key: "checkout", value: { mode: "b2c" }, version: 1 },
          { key: "flags", value: true, version: 0 },
        ]);
      }),
    );
    const rows = await svc().list();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(seenSearch).toBe("");
    expect(rows.map((r) => r.key)).toEqual(["checkout", "flags"]);
  });

  it("list serializes keys to a CSV query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().list({ keys: ["a", "b"] });
    expect((q as URLSearchParams | null)?.get("keys")).toBe("a,b");
  });

  it("get fetches one configuration by key with a typed value", async () => {
    server.use(
      http.get(`${BASE}/checkout`, () =>
        HttpResponse.json({ key: "checkout", value: { mode: "b2c" }, version: 2 }),
      ),
    );
    const c = await svc().get<{ mode: string }>("checkout");
    expect(c.value.mode).toBe("b2c");
  });

  it("get throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().get("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("create POSTs the draft array and returns the created array", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ key: "flags", value: true, version: 0 }], { status: 201 });
      }),
    );
    const created = await svc().create([{ key: "flags", value: true, secured: false }]);
    expect(body).toEqual([{ key: "flags", value: true, secured: false }]);
    expect(created[0]?.key).toBe("flags");
  });

  it("update PUTs the draft and returns the updated configuration", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/flags`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ key: "flags", value: false, version: 1 });
      }),
    );
    const updated = await svc().update("flags", { key: "flags", value: false });
    expect(body).toEqual({ key: "flags", value: false });
    expect(updated.value).toBe(false);
  });

  it("delete DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/flags`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().delete("flags")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the key in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/configuration/acme/configurations/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ key: "a/b", value: 1, version: 0 });
      }),
    );
    await svc().get("a/b");
    expect(pathname).toBe("/configuration/acme/configurations/a%2Fb");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/tenant-config.test.ts`
Expected: FAIL — cannot find module `../../src/services/tenant-config`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/tenant-config.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Configuration, ConfigurationDraft, ListConfigOptions } from "./configuration-types";

export type { Configuration, ConfigurationDraft, ListConfigOptions } from "./configuration-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Tenant-wide configuration (`/configuration/{tenant}/configurations`).
 * Requires the backend-only `configuration.configuration_view` /
 * `configuration.configuration_manage` scopes — default auth: service.
 * Server-side use only; the service token must never reach a browser.
 */
export class TenantConfigService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/configuration/${this.ctx.tenant}/configurations`;
  }

  /** List tenant configurations, optionally filtered by `keys`. */
  async list(opts: ListConfigOptions = {}, auth: AuthContext = SERVICE): Promise<Configuration[]> {
    const query = opts.keys && opts.keys.length > 0 ? { keys: opts.keys.join(",") } : undefined;
    return this.ctx.http.request<Configuration[]>({
      method: "GET",
      path: this.base(),
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Retrieve one tenant configuration by key. */
  async get<T = unknown>(key: string, auth: AuthContext = SERVICE): Promise<Configuration<T>> {
    return this.ctx.http.request<Configuration<T>>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(key)}`,
      auth,
    });
  }

  /** Create one or more tenant configurations (array in, array out). */
  async create(drafts: ConfigurationDraft[], auth: AuthContext = SERVICE): Promise<Configuration[]> {
    return this.ctx.http.request<Configuration[]>({
      method: "POST",
      path: this.base(),
      auth,
      body: drafts,
    });
  }

  /** Update one tenant configuration by key. */
  async update<T = unknown>(
    key: string,
    draft: ConfigurationDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<Configuration<T>> {
    return this.ctx.http.request<Configuration<T>>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(key)}`,
      auth,
      body: draft,
    });
  }

  /** Delete one tenant configuration by key. */
  async delete(key: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(key)}`,
      auth,
    });
  }
}
```

Create the facade `packages/sdk/src/tenant-config.ts`:

```ts
export * from "./services/tenant-config";
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/tenant-config.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/tenant-config.ts packages/sdk/src/tenant-config.ts packages/sdk/tests/services/tenant-config.test.ts
git commit -m "feat(sdk): add tenant configuration service"
```

---

## Task 4: ClientConfigService

**Files:**
- Create: `packages/sdk/src/services/client-config.ts`, `packages/sdk/src/client-config.ts`
- Test: `packages/sdk/tests/services/client-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/client-config.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ClientConfigService } from "../../src/services/client-config";
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

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "configuration" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ClientConfigService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/configuration/acme/clients/saas-ag.x/configurations";

describe("ClientConfigService", () => {
  it("list GETs configurations for the client", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: true, version: 0 },
        ]);
      }),
    );
    const rows = await svc().list("saas-ag.x");
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(rows[0]?._id).toBe("saas-ag.x_flags");
  });

  it("list serializes keys to a CSV query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().list("saas-ag.x", { keys: ["a", "b"] });
    expect((q as URLSearchParams | null)?.get("keys")).toBe("a,b");
  });

  it("get fetches one client configuration by key", async () => {
    server.use(
      http.get(`${BASE}/flags`, () =>
        HttpResponse.json({ _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: true, version: 1 }),
      ),
    );
    const c = await svc().get<boolean>("saas-ag.x", "flags");
    expect(c.value).toBe(true);
    expect(c.client).toBe("saas-ag.x");
  });

  it("create injects the client into each body item and returns the created array", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          [{ _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: true, version: 0 }],
          { status: 201 },
        );
      }),
    );
    const created = await svc().create("saas-ag.x", [{ key: "flags", value: true }]);
    expect(body).toEqual([{ key: "flags", value: true, client: "saas-ag.x" }]);
    expect(created[0]?._id).toBe("saas-ag.x_flags");
  });

  it("update injects the client and PUTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/flags`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: false, version: 1 });
      }),
    );
    const updated = await svc().update("saas-ag.x", "flags", { key: "flags", value: false });
    expect(body).toEqual({ key: "flags", value: false, client: "saas-ag.x" });
    expect(updated.value).toBe(false);
  });

  it("delete DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/flags`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().delete("saas-ag.x", "flags")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/client-config.test.ts`
Expected: FAIL — cannot find module `../../src/services/client-config`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/client-config.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { ClientConfiguration, ConfigurationDraft, ListConfigOptions } from "./configuration-types";

export type { ClientConfiguration } from "./configuration-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Per-client configuration (`/configuration/{tenant}/clients/{client}/configurations`).
 * Requires the backend-only `configuration.configuration_view` /
 * `configuration.configuration_manage` scopes — default auth: service.
 * Server-side use only; the service token must never reach a browser.
 * The `client` arg is injected into each write body so callers don't repeat it.
 */
export class ClientConfigService {
  constructor(private readonly ctx: ClientContext) {}

  private base(client: string): string {
    return `/configuration/${this.ctx.tenant}/clients/${encodeURIComponent(client)}/configurations`;
  }

  /** List a client's configurations, optionally filtered by `keys`. */
  async list(
    client: string,
    opts: ListConfigOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration[]> {
    const query = opts.keys && opts.keys.length > 0 ? { keys: opts.keys.join(",") } : undefined;
    return this.ctx.http.request<ClientConfiguration[]>({
      method: "GET",
      path: this.base(client),
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Retrieve one client configuration by key. */
  async get<T = unknown>(
    client: string,
    key: string,
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration<T>> {
    return this.ctx.http.request<ClientConfiguration<T>>({
      method: "GET",
      path: `${this.base(client)}/${encodeURIComponent(key)}`,
      auth,
    });
  }

  /** Create one or more client configurations. Injects `client` into each item. */
  async create(
    client: string,
    drafts: ConfigurationDraft[],
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration[]> {
    const body = drafts.map((d) => ({ ...d, client }));
    return this.ctx.http.request<ClientConfiguration[]>({
      method: "POST",
      path: this.base(client),
      auth,
      body,
    });
  }

  /** Update one client configuration by key. Injects `client` into the body. */
  async update<T = unknown>(
    client: string,
    key: string,
    draft: ConfigurationDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration<T>> {
    return this.ctx.http.request<ClientConfiguration<T>>({
      method: "PUT",
      path: `${this.base(client)}/${encodeURIComponent(key)}`,
      auth,
      body: { ...draft, client },
    });
  }

  /** Delete one client configuration by key. */
  async delete(client: string, key: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base(client)}/${encodeURIComponent(key)}`,
      auth,
    });
  }
}
```

Create the facade `packages/sdk/src/client-config.ts`:

```ts
export * from "./services/client-config";
```

> **Verify-during-implementation note (from the spec):** the client `DELETE` endpoint is assumed symmetric with the tenant one. After Task 1, confirm `DELETE /configuration/{tenant}/clients/{client}/configurations/{propertyKey}` exists in `packages/sdk/specs/configuration.yml` (`grep -n "clients" packages/sdk/specs/configuration.yml`). If it does **not** exist, delete the `delete` method above and its test in Step 1.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/client-config.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/client-config.ts packages/sdk/src/client-config.ts packages/sdk/tests/services/client-config.test.ts
git commit -m "feat(sdk): add client configuration service"
```

---

## Task 5: Wire the services onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/configuration-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/configuration-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { TenantConfigService } from "../../src/services/tenant-config";
import { ClientConfigService } from "../../src/services/client-config";

describe("EmporixClient configuration wiring", () => {
  it("exposes tenantConfig and clientConfig services", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.tenantConfig).toBeInstanceOf(TenantConfigService);
    expect(sdk.clientConfig).toBeInstanceOf(ClientConfigService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/configuration-wiring.test.ts`
Expected: FAIL — `sdk.tenantConfig` is `undefined` (not an instance).

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"configuration"` to the `ServiceName` union (insert before `| "http"`):

```ts
  | "availability"
  | "configuration"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the services in `client.ts`**

In `packages/sdk/src/client.ts`, add the imports next to the other service imports:

```ts
import { TenantConfigService } from "./services/tenant-config";
import { ClientConfigService } from "./services/client-config";
```

Add the readonly fields next to the other service fields (after `availability`):

```ts
  readonly tenantConfig: TenantConfigService;
  readonly clientConfig: ClientConfigService;
```

Construct them in the constructor next to the other `this.x = new XService(mk(...))` lines (after `this.availability = ...`):

```ts
    this.tenantConfig = new TenantConfigService(mk("configuration"));
    this.clientConfig = new ClientConfigService(mk("configuration"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add these two lines next to the other `export * from "./<facade>"` lines (after `export * from "./availability";`):

```ts
export * from "./tenant-config";
export * from "./client-config";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/configuration-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/configuration-wiring.test.ts
git commit -m "feat(sdk): expose configuration services on the client"
```

---

## Task 6: Documentation

**Files:**
- Create: `docs/configuration.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/configuration.md`:

````markdown
# Configuration Service

Bindings for the Emporix **Configuration Service** (`/configuration/{tenant}/…`):
tenant-wide and per-client key/value configuration.

> **Server-side only.** Every endpoint requires the backend
> `configuration.configuration_view` / `configuration.configuration_manage`
> scopes, served by the **service (clientCredentials) token**. Never construct
> these calls from a browser — the admin token must not be exposed. Use them in
> Node, Next.js route handlers / server actions, or other trusted backends.

## Tenant configurations — `client.tenantConfig`

```ts
// list (optionally filter by keys)
const all = await client.tenantConfig.list();
const some = await client.tenantConfig.list({ keys: ["checkout", "flags"] });

// get one, with a typed value
const checkout = await client.tenantConfig.get<{ mode: "b2c" | "b2b" }>("checkout");
checkout.value.mode; // typed

// create (array in, array out)
await client.tenantConfig.create([{ key: "flags", value: { newCart: true } }]);

// update one
await client.tenantConfig.update("flags", { key: "flags", value: { newCart: false } });

// delete one
await client.tenantConfig.delete("flags");
```

## Client configurations — `client.clientConfig`

The first argument is always the client id; `client` is injected into write bodies.

```ts
const cfgs = await client.clientConfig.list("saas-ag.caas-indexing-service-client");
const one = await client.clientConfig.get<boolean>("saas-ag.x", "algolia_activation");
await client.clientConfig.create("saas-ag.x", [{ key: "algolia_activation", value: true }]);
await client.clientConfig.update("saas-ag.x", "algolia_activation", { key: "algolia_activation", value: false });
await client.clientConfig.delete("saas-ag.x", "algolia_activation");
```

## Configuration flags

`ConfigurationDraft` accepts: `description`, `secured` (encrypts a string value
at rest), `restricted` (cannot be deleted), `readOnly` (cannot be updated),
`schemaUrl` (JSON-Schema validation; immutable once set).

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row in the workspace-layout table and add the configuration services to the parenthesized service list. Change:

```
| `packages/sdk` | Core SDK: HTTP, auth, services (Product, Category, Cart, Checkout, Customer, Payment, Price, Media, Segment, Site, SessionContext, Companies, Contacts, Locations, CustomerGroups) | yes (`@viu/emporix-sdk`) |
```
to add `, TenantConfig, ClientConfig` before the closing paren:
```
| `packages/sdk` | Core SDK: HTTP, auth, services (Product, Category, Cart, Checkout, Customer, Payment, Price, Media, Segment, Site, SessionContext, Companies, Contacts, Locations, CustomerGroups, TenantConfig, ClientConfig) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/configuration.md CLAUDE.md
git commit -m "docs(sdk): document the configuration services"
```

---

## Task 7: Changeset

**Files:**
- Create: `.changeset/configuration-services.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/configuration-services.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add Configuration Service bindings: `client.tenantConfig` and
`client.clientConfig` provide full CRUD (`list`/`get`/`create`/`update`/`delete`)
over tenant-wide and per-client configuration. Server-side only — these use the
service (clientCredentials) token and must not be called from a browser.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` for a minor bump, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/configuration-services.md
git commit -m "chore(release): add configuration services changeset"
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

- **Spec coverage:** D1 full CRUD → Tasks 3+4 (all five methods each). D2 no React → no React tasks. D3 two services → `tenantConfig`/`clientConfig` in Task 5. D4 `delete` name → used in 3+4. D5 generic value → `Configuration<T>` in Task 2, used in `get`/`update`. D6 codegen → Task 1. D7 service-token default → `const SERVICE` in 3+4. Tests section → Tasks 2/3/4/5. Docs/changeset → Tasks 6/7. No gaps.
- **Placeholder scan:** No TBD/TODO; every code step has full code; the one upstream-dependent uncertainty (generated type name; client DELETE existence) is a concrete `grep` verification with a defined fallback, not a placeholder.
- **Type consistency:** `Configuration` / `ClientConfiguration` / `ConfigurationDraft` / `ListConfigOptions` names match across Tasks 2→3→4. Methods `list`/`get`/`create`/`update`/`delete` consistent. `request` (not `req`) used everywhere, matching `media.ts`. Re-exports are non-overlapping (`Configuration`/`ConfigurationDraft`/`ListConfigOptions` from `tenant-config`; `ClientConfiguration` from `client-config`).
