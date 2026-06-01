# AI RAG Indexer Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single server-side core SDK service, `client.ragIndexer`, binding the Emporix AI RAG Indexer's three endpoints: `ragMetadata` (GET indexable embedding fields), `filterMetadata` (GET filterable fields), and `reindex` (POST, trigger a full async rebuild → 204).

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module aliases the generated `MetadataFilter` and declares the `RagType` union. One focused service class mirrors the single API group, defaulting to the service (clientCredentials) token like `media`/`tenant-config`. It is wired onto `EmporixClient` exactly like the other services. No React bindings.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-ai-rag-indexer-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `ai-rag-indexer` spec URL to the fetch list |
| `packages/sdk/specs/ai-rag-indexer.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/ai-rag-indexer/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/ai-rag-indexer-types.ts` | public types: `MetadataFilter`, `RagType` |
| `packages/sdk/src/services/ai-rag-indexer.ts` | `RagIndexerService` (`ragMetadata`/`filterMetadata`/`reindex`) |
| `packages/sdk/src/ai-rag-indexer.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"ai-rag-indexer"` to the `ServiceName` union |
| `packages/sdk/src/client.ts` | construct + expose `ragIndexer` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/ai-rag-indexer-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/ai-rag-indexer.test.ts` | MSW tests |
| `packages/sdk/tests/services/ai-rag-indexer-wiring.test.ts` | client wiring test |
| `docs/ai-rag-indexer.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/ai-rag-indexer.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

---

## Task 1: Generate AI RAG Indexer types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/ai-rag-indexer.yml`, `packages/sdk/src/generated/ai-rag-indexer/index.ts`, `packages/sdk/src/generated/ai-rag-indexer/types.gen.ts`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add this line to the `SPECS` object (after the `configuration` entry):

```ts
  "ai-rag-indexer": `${BASE}/artificial-intelligence/ai-rag-indexer/api-reference/api.yml`,
```

(URL verified live → HTTP 200.)

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched ai-rag-indexer (...bytes)` and `generated ai-rag-indexer` (alongside the existing specs).

- [ ] **Step 3: Verify the generated type names**

Run:
```bash
grep -nE "MetadataFilter|PRODUCT" packages/sdk/src/generated/ai-rag-indexer/types.gen.ts
```
Expected: a `MetadataFilter` type (an object with `key`, `type`, optional deprecated `name`/`description`) and a `"PRODUCT"` literal in the path-`type` enum. **`MetadataFilter` is the only name Task 2 imports.** If hey-api emitted a different name for that schema, note the actual name — Task 2's import must match it. If `"PRODUCT"` is the only enum member, the hand-written `RagType = "PRODUCT"` in Task 2 is correct as-is.

- [ ] **Step 4: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` also touched other `specs/*.yml` or `src/generated/*` files (upstream drift unrelated to this feature), restore them so this PR stays scoped:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-run Step 2 and immediately stage ONLY the `ai-rag-indexer` outputs in Step 5. (If `git status` showed only the new `ai-rag-indexer` files, skip this step.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/ai-rag-indexer.yml packages/sdk/src/generated/ai-rag-indexer
git commit -m "feat(sdk): generate ai rag indexer types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/ai-rag-indexer-types.ts`
- Test: `packages/sdk/tests/services/ai-rag-indexer-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/ai-rag-indexer-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { MetadataFilter, RagType } from "../../src/services/ai-rag-indexer-types";

describe("ai rag indexer types", () => {
  it("MetadataFilter has key + a field-type union", () => {
    const f: MetadataFilter = { key: "price", type: "float" };
    expectTypeOf(f.key).toEqualTypeOf<string>();
    // `type` accepts every documented field type
    const types: MetadataFilter["type"][] = [
      "string", "integer", "float", "boolean",
      "datetime", "date", "time", "dictionary", "list", "object",
    ];
    expectTypeOf(types).toEqualTypeOf<MetadataFilter["type"][]>();
  });

  it("RagType is the PRODUCT literal", () => {
    const t: RagType = "PRODUCT";
    expectTypeOf(t).toEqualTypeOf<RagType>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-rag-indexer-types.test.ts`
Expected: FAIL — cannot find module `../../src/services/ai-rag-indexer-types`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/ai-rag-indexer-types.ts`:

```ts
import type { MetadataFilter as GenMetadataFilter } from "../generated/ai-rag-indexer";

/**
 * A filterable metadata field exposed by the RAG index. `key` is the field
 * name and `type` its scalar/structured kind. `name` and `description` are
 * **deprecated** upstream — present for wire compatibility, do not rely on them.
 */
export type MetadataFilter = GenMetadataFilter;

/**
 * Indexable resource type. Only `"PRODUCT"` exists today; modelled as a string
 * union so future types can extend it without a breaking change. Every
 * {@link RagIndexerService} method defaults its `type` argument to `"PRODUCT"`.
 */
export type RagType = "PRODUCT";
```

If Task 1, Step 3 reported a different name for the generated filter schema, change the import accordingly (e.g. `import type { Filter as GenMetadataFilter } from "../generated/ai-rag-indexer";`).

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-rag-indexer-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

> If the generated `MetadataFilter.type` is a plain `string` (hey-api sometimes widens enums), the `types` array in Step 1 still type-checks; the assertion remains valid. No change needed.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai-rag-indexer-types.ts packages/sdk/tests/services/ai-rag-indexer-types.test.ts
git commit -m "feat(sdk): add ai rag indexer public types"
```

---

## Task 3: RagIndexerService

**Files:**
- Create: `packages/sdk/src/services/ai-rag-indexer.ts`, `packages/sdk/src/ai-rag-indexer.ts`
- Test: `packages/sdk/tests/services/ai-rag-indexer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/ai-rag-indexer.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { RagIndexerService } from "../../src/services/ai-rag-indexer";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "ai-rag-indexer" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new RagIndexerService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/ai-rag-indexer/acme/PRODUCT";

describe("RagIndexerService", () => {
  it("ragMetadata GETs the embedding fields with a service token, default type PRODUCT", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/rag-metadata`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(["name", "description", "brand"]);
      }),
    );
    const fields = await svc().ragMetadata();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(fields).toEqual(["name", "description", "brand"]);
  });

  it("filterMetadata GETs the filterable fields", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/filter-metadata`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { key: "price", type: "float" },
          { key: "inStock", type: "boolean" },
        ]);
      }),
    );
    const filters = await svc().filterMetadata();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(filters.map((f) => f.key)).toEqual(["price", "inStock"]);
    expect(filters[0]?.type).toBe("float");
  });

  it("reindex POSTs with no body and resolves to void on 204", async () => {
    let method = "";
    let bodyText = "init";
    server.use(
      http.post(`${BASE}/reindex`, async ({ request }) => {
        method = request.method;
        bodyText = await request.text();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().reindex()).resolves.toBeUndefined();
    expect(method).toBe("POST");
    expect(bodyText).toBe("");
  });

  it("threads an explicit type through the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/ai-rag-indexer/acme/*/rag-metadata", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([]);
      }),
    );
    // cast: the surface only declares "PRODUCT" today, but the path must honour any type
    await svc().ragMetadata("PRODUCT" as never);
    expect(pathname).toBe("/ai-rag-indexer/acme/PRODUCT/rag-metadata");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-rag-indexer.test.ts`
Expected: FAIL — cannot find module `../../src/services/ai-rag-indexer`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/ai-rag-indexer.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { MetadataFilter, RagType } from "./ai-rag-indexer-types";

export type { MetadataFilter, RagType } from "./ai-rag-indexer-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * AI RAG Indexer (`/ai-rag-indexer/{tenant}/{type}`). Read which fields the RAG
 * index embeds / can filter on, and trigger a full asynchronous rebuild.
 *
 * Requires the backend-only `ai.agent_read` (reads) / `ai.agent_manage`
 * (`reindex`) scopes — default auth: service. **Server-side use only**; the
 * service token must never reach a browser.
 *
 * Quirks: only `PRODUCT` exists today (the `type` arg defaults to it);
 * `reindex` is a **full** rebuild (no delta), runs **asynchronously**, returns
 * `204` once *scheduled* (not on completion), has **no status endpoint** to
 * poll, and is costly — call it sparingly. The set of embedded fields is
 * configured in the AI Service, not here.
 */
export class RagIndexerService {
  constructor(private readonly ctx: ClientContext) {}

  private base(type: RagType): string {
    return `/ai-rag-indexer/${this.ctx.tenant}/${encodeURIComponent(type)}`;
  }

  /** The indexable embedding field names for `type` (default `"PRODUCT"`). */
  async ragMetadata(type: RagType = "PRODUCT", auth: AuthContext = SERVICE): Promise<string[]> {
    return this.ctx.http.request<string[]>({
      method: "GET",
      path: `${this.base(type)}/rag-metadata`,
      auth,
    });
  }

  /** The filterable metadata fields for `type` (default `"PRODUCT"`). */
  async filterMetadata(
    type: RagType = "PRODUCT",
    auth: AuthContext = SERVICE,
  ): Promise<MetadataFilter[]> {
    return this.ctx.http.request<MetadataFilter[]>({
      method: "GET",
      path: `${this.base(type)}/filter-metadata`,
      auth,
    });
  }

  /**
   * Schedule a full asynchronous re-index for `type` (default `"PRODUCT"`).
   * Resolves once the rebuild is *scheduled* (HTTP 204); there is no progress
   * to await or poll. Costly — avoid calling on a hot path.
   */
  async reindex(type: RagType = "PRODUCT", auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base(type)}/reindex`,
      auth,
    });
  }
}
```

Create the facade `packages/sdk/src/ai-rag-indexer.ts`:

```ts
export * from "./services/ai-rag-indexer";
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-rag-indexer.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

> If `reindex` sends a body in the captured request (`bodyText !== ""`), confirm `HttpClient.request` omits the body when `body` is absent — it does for the other services (`tenant-config.delete`). Do **not** pass `body` to `reindex`.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/ai-rag-indexer.ts packages/sdk/src/ai-rag-indexer.ts packages/sdk/tests/services/ai-rag-indexer.test.ts
git commit -m "feat(sdk): add ai rag indexer service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/ai-rag-indexer-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/ai-rag-indexer-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { RagIndexerService } from "../../src/services/ai-rag-indexer";

describe("EmporixClient ai rag indexer wiring", () => {
  it("exposes the ragIndexer service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.ragIndexer).toBeInstanceOf(RagIndexerService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-rag-indexer-wiring.test.ts`
Expected: FAIL — `sdk.ragIndexer` is `undefined` (not an instance).

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"ai-rag-indexer"` to the `ServiceName` union (insert after `"configuration"`, before `"http"`):

```ts
  | "configuration"
  | "ai-rag-indexer"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

In `packages/sdk/src/client.ts`, add the import next to the other service imports (after the `ClientConfigService` import):

```ts
import { RagIndexerService } from "./services/ai-rag-indexer";
```

Add the readonly field next to the other service fields (after `clientConfig`):

```ts
  readonly ragIndexer: RagIndexerService;
```

Construct it in the constructor next to the other `this.x = new XService(mk(...))` lines (after `this.clientConfig = ...`):

```ts
    this.ragIndexer = new RagIndexerService(mk("ai-rag-indexer"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add this line next to the other `export * from "./<facade>"` lines (after `export * from "./client-config";`):

```ts
export * from "./ai-rag-indexer";
```

- [ ] **Step 4: Run the wiring test, full suite + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/ai-rag-indexer-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/ai-rag-indexer-wiring.test.ts
git commit -m "feat(sdk): expose ai rag indexer service on the client"
```

---

## Task 5: Documentation

**Files:**
- Create: `docs/ai-rag-indexer.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/ai-rag-indexer.md`:

````markdown
# AI RAG Indexer

Bindings for the Emporix **AI RAG Indexer** (`/ai-rag-indexer/{tenant}/{type}`),
which maintains the vector index backing AI/RAG features. Exposed as
`client.ragIndexer`. Read-and-trigger only: discover the embedded / filterable
fields, and kick off a full rebuild.

> **Server-side only.** Reads require the backend `ai.agent_read` scope and
> `reindex` requires `ai.agent_manage`, both served by the **service
> (clientCredentials) token**. Never call these from a browser — the admin
> token must not be exposed. Use them in Node, Next.js route handlers / server
> actions, or other trusted backends.

## Scope & quirks

- **Only `PRODUCT`** is supported today, so the `type` argument defaults to
  `"PRODUCT"` and is normally omitted.
- `reindex` triggers a **full** rebuild (no delta), runs **asynchronously**, and
  returns once the rebuild is *scheduled* — there is **no status endpoint** to
  poll, and it is **costly**, so call it sparingly.
- The set of embedded fields is configured in the **AI Service**, not here. This
  binding only *reads* the current field metadata and *triggers* a rebuild.
- `MetadataFilter.name` / `MetadataFilter.description` are **deprecated**
  upstream; rely on `key` and `type`.

## SDK

```ts
// Which fields are embedded for products?
const embedded = await client.ragIndexer.ragMetadata();
// → ["name", "description", "brand", ...]

// Which fields can be filtered on, and of what type?
const filters = await client.ragIndexer.filterMetadata();
for (const f of filters) console.log(f.key, f.type); // e.g. "price" "float"

// Trigger a full async rebuild (returns once scheduled; no progress to await)
await client.ragIndexer.reindex();
```

`MetadataFilter.type` is one of `string | integer | float | boolean | datetime |
date | time | dictionary | list | object`.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row in the workspace-layout table and add `RagIndexer` to the parenthesized service list (after `ClientConfig`):

```
| `packages/sdk` | Core SDK: HTTP, auth, services (Product, Category, Cart, Checkout, Customer, Payment, Price, Media, Segment, Site, SessionContext, Companies, Contacts, Locations, CustomerGroups, TenantConfig, ClientConfig, RagIndexer) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/ai-rag-indexer.md CLAUDE.md
git commit -m "docs(sdk): document the ai rag indexer service"
```

---

## Task 6: Changeset

**Files:**
- Create: `.changeset/ai-rag-indexer.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/ai-rag-indexer.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add AI RAG Indexer binding: `client.ragIndexer` exposes `ragMetadata()` and
`filterMetadata()` to discover the indexed embedding / filterable fields, plus
`reindex()` to trigger a full asynchronous index rebuild. Server-side only —
these use the service (clientCredentials) token (`ai.agent_read` /
`ai.agent_manage`) and must not be called from a browser.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` for a minor bump, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/ai-rag-indexer.md
git commit -m "chore(release): add ai rag indexer changeset"
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

- **Spec coverage:** D1 bind all 3 → Task 3 has `ragMetadata`/`filterMetadata`/`reindex`; no status-poll method (none exists). D2 no React → no React tasks/files. D3 one service `ragIndexer` → Task 4 wiring. D4 `type` defaults to `"PRODUCT"` (a param, `RagType` union) → every method in Task 3 + the type in Task 2. D5 `reindex` → `Promise<void>` on 204, no body → Task 3 service + test asserts empty body. D6 codegen + thin aliases → Tasks 1+2. D7 service-token default → `const SERVICE` in Task 3. Tests section → Tasks 2/3/4. Docs/changeset → Tasks 5/6. No gaps.
- **Placeholder scan:** No TBD/TODO; every code step has full code; the only upstream-dependent uncertainties (generated `MetadataFilter` name; `"PRODUCT"` being the sole enum member; whether hey-api widens the field-type enum to `string`) are concrete `grep` verifications with defined fallbacks, not placeholders.
- **Type consistency:** `MetadataFilter` / `RagType` names match across Tasks 2→3. Methods `ragMetadata`/`filterMetadata`/`reindex` consistent across spec, service, tests, docs, changeset. `request` (not `req`) used everywhere, matching `media.ts`/`tenant-config.ts`. The facade re-exports `MetadataFilter`/`RagType` from `ai-rag-indexer-types` via the service module — no overlap.
- **Wiring consistency:** logger `ServiceName` gains `"ai-rag-indexer"`; `client.ts` uses `mk("ai-rag-indexer")` for the same key; the `index.ts` re-export follows `client-config`. Matches the configuration-service plan's wiring exactly.
- **Path correctness:** base is `/ai-rag-indexer/${tenant}/${enc(type)}`; the three suffixes (`/rag-metadata`, `/filter-metadata`, `/reindex`) match the verified upstream endpoints. The default-type test asserts the literal `PRODUCT` path segment.
