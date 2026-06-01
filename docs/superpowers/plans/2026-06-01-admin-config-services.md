# Admin Config/Utility Services (Batch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind three admin services in one branch — `client.sepaExport`, `client.indexing`, `client.units` (~20 ops).

**Architecture:** Types generated via `@hey-api/openapi-ts` and aliased per service. Three service classes, service-token default, no React. SEPA `getFile` returns a raw `text/plain` file via `HttpClient.requestRaw` (the `MediaService.download` pattern). Standard tenant base paths.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-admin-config-services-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `sepa-export`, `indexing-service`, `unit-handling-service` URLs |
| `packages/sdk/specs/{sepa-export,indexing-service,unit-handling-service}.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/{sepa-export,indexing-service,unit-handling-service}/` | generated types |
| `packages/sdk/src/services/{sepa-export,indexing,unit-handling}-types.ts` | public type aliases |
| `packages/sdk/src/services/{sepa-export,indexing,unit-handling}.ts` | service classes |
| `packages/sdk/src/{sepa-export,indexing,unit-handling}.ts` | facade re-exports |
| `packages/sdk/src/core/logger.ts` | add `"sepa-export"`, `"indexing"`, `"unit-handling"` |
| `packages/sdk/src/client.ts` | construct + expose `sepaExport`, `indexing`, `units` |
| `packages/sdk/src/index.ts` | re-export the facades |
| `packages/sdk/tests/services/*` | type + MSW + wiring tests |
| `docs/{sepa-export,indexing,unit-handling}.md` | usage docs |
| `CLAUDE.md` | service-list update |
| `.changeset/admin-config-services.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/admin-config-services` off current `main`, commit spec + plan first:
```bash
git checkout main && git pull
git checkout -b feat/admin-config-services
git add docs/superpowers/specs/2026-06-01-admin-config-services-design.md docs/superpowers/plans/2026-06-01-admin-config-services.md
git commit -m "docs(sdk): add admin config services design spec and plan"
```

---

## Task 1: Generate types (codegen)

- [ ] **Step 1: Add the spec entries** — in `fetch-specs.ts`, after `returns`:

```ts
  "sepa-export": `${BASE}/orders/sepa-export/api-reference/api.yml`,
  "indexing-service": `${BASE}/configuration/indexing-service/api-reference/api.yml`,
  "unit-handling-service": `${BASE}/configuration/unit-handling-service/api-reference/api.yml`,
```

- [ ] **Step 2: Fetch + generate** — `pnpm -F @viu/emporix-sdk fetch:specs` then `generate`.

- [ ] **Step 3: Verify generated names** — record for Tasks 2-4:

```bash
for d in sepa-export indexing-service unit-handling-service; do
  echo "== $d =="; grep -nE "^export type " packages/sdk/src/generated/$d/types.gen.ts | grep -viE "Data =|Error|Responses|Response =|ClientOptions|Trait"
done
```
Expected names: SEPA `JobDetails`/`CreateJob`/`JobId`; Indexing `IndexConfiguration`/`IndexCreationResponse`/`IndexPublicConfiguration`/`Reindex`; Unit `Unit`/`BaseUnit`/`UpdateUnit`/`CreateUnitResponse`/`ConversionFactorPayload`/`ConversionFactorResponse`/`ConversionPayload`/`ConversionResponse` + the `GET /types` response. Confirm update/delete/reindex response codes and the bulk-delete `codes` query param.

- [ ] **Step 4: Keep focused** — restore unrelated drift; stage only the three new spec/generated trees.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/sepa-export.yml packages/sdk/specs/indexing-service.yml packages/sdk/specs/unit-handling-service.yml packages/sdk/src/generated/sepa-export packages/sdk/src/generated/indexing-service packages/sdk/src/generated/unit-handling-service
git commit -m "feat(sdk): generate admin config service types"
```

---

## Task 2: SepaExportService

- [ ] **Step 1: `sepa-export-types.ts`** (swap names for the real generated ones):

```ts
import type { JobDetails, CreateJob, JobId } from "../generated/sepa-export";

/** A SEPA export job (read/list item). */
export type SepaJob = JobDetails;
/** Create-job body (`POST /jobs`). */
export type SepaJobInput = CreateJob;
/** `POST /jobs` response — the created job's id. */
export type SepaJobCreated = JobId;
```

Type test `sepa-export-types.test.ts`: assert all three `not.toBeNever()`. (Write test first, verify it fails, then the module.)

- [ ] **Step 2: `sepa-export.ts` service + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { errorFromResponse } from "../core/errors";
import type { SepaJob, SepaJobInput, SepaJobCreated } from "./sepa-export-types";

export type { SepaJob, SepaJobInput, SepaJobCreated } from "./sepa-export-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix SEPA Export Service (`/sepa-export/{tenant}/…`): export jobs and file
 * retrieval. Server-side; defaults to the service token.
 */
export class SepaExportService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/sepa-export/${this.ctx.tenant}`;
  }

  /** Retrieve a SEPA export file by id. Returns the raw file content (text). */
  async getFile(fileId: string, auth: AuthContext = SERVICE): Promise<string> {
    const path = `${this.base()}/files/${encodeURIComponent(fileId)}`;
    const res = await this.ctx.http.requestRaw({ method: "GET", path, auth });
    if (!res.ok) throw errorFromResponse(res.status, `GET ${path} → ${res.status}`);
    return res.text();
  }

  /** List export jobs. */
  async listJobs(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<SepaJob[]> {
    return this.ctx.http.request<SepaJob[]>({
      method: "GET",
      path: `${this.base()}/jobs`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Create an export job. */
  async createJob(input: SepaJobInput, auth: AuthContext = SERVICE): Promise<SepaJobCreated> {
    return this.ctx.http.request<SepaJobCreated>({
      method: "POST",
      path: `${this.base()}/jobs`,
      auth,
      body: input,
    });
  }
}
```

Facade `src/sepa-export.ts`: `export * from "./services/sepa-export";`

MSW test `sepa-export.test.ts` (`BASE = "https://api.emporix.io/sepa-export/acme"`):
- `getFile`: `http.get(`${BASE}/files/f1`, () => new HttpResponse("SEPA-XML", { headers: { "Content-Type": "text/plain" } }))` → expect `getFile("f1")` resolves to `"SEPA-XML"` and `Bearer svc-tok` seen.
- `getFile` 404 → `new HttpResponse(null, { status: 404 })` → rejects `EmporixNotFoundError`.
- `listJobs` → array; `createJob` → body asserted, returns `{ id }` (pin shape).
- `encodeURIComponent` on fileId.

- [ ] **Step 3: Run sepa tests + typecheck; commit (two commits: types, service).**

```bash
git commit -m "feat(sdk): add sepa export public types"   # types + test
git commit -m "feat(sdk): add sepa export service"         # service + facade + test
```

---

## Task 3: IndexingService

- [ ] **Step 1: `indexing-types.ts`**

```ts
import type {
  IndexConfiguration,
  IndexCreationResponse,
  IndexPublicConfiguration,
  Reindex,
} from "../generated/indexing-service";

/** An indexing configuration (read + write body). */
export type IndexConfig = IndexConfiguration;
/** `POST /configurations` response. */
export type IndexConfigCreated = IndexCreationResponse;
/** A public indexing configuration. */
export type IndexPublicConfig = IndexPublicConfiguration;
/** Body for `reindex`. */
export type ReindexInput = Reindex;
```

Type test: assert all `not.toBeNever()`.

- [ ] **Step 2: `indexing.ts` service + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { IndexConfig, IndexConfigCreated, IndexPublicConfig, ReindexInput } from "./indexing-types";

export type { IndexConfig, IndexConfigCreated, IndexPublicConfig, ReindexInput } from "./indexing-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Indexing Service (`/indexing/{tenant}/…`): search-index provider
 * configurations and reindex. Server-side; defaults to the service token.
 */
export class IndexingService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/indexing/${this.ctx.tenant}`;
  }

  /** List indexing configurations. */
  async listConfigurations(auth: AuthContext = SERVICE): Promise<IndexConfig[]> {
    return this.ctx.http.request<IndexConfig[]>({ method: "GET", path: `${this.base()}/configurations`, auth });
  }

  /** Get a configuration by provider name. */
  async getConfiguration(provider: string, auth: AuthContext = SERVICE): Promise<IndexConfig> {
    return this.ctx.http.request<IndexConfig>({
      method: "GET",
      path: `${this.base()}/configurations/${encodeURIComponent(provider)}`,
      auth,
    });
  }

  /** Create a configuration. */
  async createConfiguration(input: IndexConfig, auth: AuthContext = SERVICE): Promise<IndexConfigCreated> {
    return this.ctx.http.request<IndexConfigCreated>({ method: "POST", path: `${this.base()}/configurations`, auth, body: input });
  }

  /** Update a configuration by provider name. */
  async updateConfiguration(provider: string, input: IndexConfig, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/configurations/${encodeURIComponent(provider)}`,
      auth,
      body: input,
    });
  }

  /** Delete a configuration by provider name. */
  async deleteConfiguration(provider: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/configurations/${encodeURIComponent(provider)}`,
      auth,
    });
  }

  /** List public indexing configurations. */
  async listPublicConfigurations(auth: AuthContext = SERVICE): Promise<IndexPublicConfig[]> {
    return this.ctx.http.request<IndexPublicConfig[]>({ method: "GET", path: `${this.base()}/public/configurations`, auth });
  }

  /** Get a public configuration by provider name. */
  async getPublicConfiguration(provider: string, auth: AuthContext = SERVICE): Promise<IndexPublicConfig> {
    return this.ctx.http.request<IndexPublicConfig>({
      method: "GET",
      path: `${this.base()}/public/configurations/${encodeURIComponent(provider)}`,
      auth,
    });
  }

  /** Trigger a reindex. */
  async reindex(input: ReindexInput, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "POST", path: `${this.base()}/reindex`, auth, body: input });
  }
}
```

Facade `src/indexing.ts`: `export * from "./services/indexing";`

MSW test `indexing.test.ts` (`BASE = "https://api.emporix.io/indexing/acme"`): list/get/create (201 → IndexCreationResponse)/update (204 void)/delete (204)/public list+get/reindex (204); `Bearer svc-tok`; `encodeURIComponent` on provider; 404 on get.

> If create/update/reindex responses differ (e.g. update returns the config),
> adjust the return types + mocks.

- [ ] **Step 3: Run indexing tests + typecheck; commit (types, service).**

---

## Task 4: UnitHandlingService

- [ ] **Step 1: `unit-handling-types.ts`**

```ts
import type {
  Unit as GenUnit,
  BaseUnit,
  UpdateUnit,
  CreateUnitResponse,
  ConversionFactorPayload,
  ConversionFactorResponse,
  ConversionPayload,
  ConversionResponse,
} from "../generated/unit-handling-service";

/** A unit (read shape). */
export type Unit = GenUnit;
/** Create body (`POST /units`). */
export type UnitInput = BaseUnit;
/** Update body (`PUT /units/{code}`). */
export type UnitUpdate = UpdateUnit;
/** `POST /units` response. */
export type UnitCreated = CreateUnitResponse;
/** Body / result of `getConversionFactor`. */
export type ConversionFactorInput = ConversionFactorPayload;
export type ConversionFactorResult = ConversionFactorResponse;
/** Body / result of `convertUnit`. */
export type ConvertUnitInput = ConversionPayload;
export type ConvertUnitResult = ConversionResponse;
```

> Add `UnitTypeList` aliased to the `GET /types` response if it is a named type;
> otherwise type `listUnitTypes` as `Promise<unknown[]>` and note it. Type test
> asserts the named ones `not.toBeNever()`.

- [ ] **Step 2: `unit-handling.ts` service + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Unit, UnitInput, UnitUpdate, UnitCreated,
  ConversionFactorInput, ConversionFactorResult,
  ConvertUnitInput, ConvertUnitResult,
} from "./unit-handling-types";

export type {
  Unit, UnitInput, UnitUpdate, UnitCreated,
  ConversionFactorInput, ConversionFactorResult,
  ConvertUnitInput, ConvertUnitResult,
} from "./unit-handling-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Unit Handling Service (`/unit-handling/{tenant}/…`): units CRUD,
 * unit types, and conversion commands. Server-side; defaults to the service token.
 */
export class UnitHandlingService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/unit-handling/${this.ctx.tenant}`;
  }

  /** Find units (filter/sort/page). */
  async listUnits(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<Unit[]> {
    return this.ctx.http.request<Unit[]>({
      method: "GET",
      path: `${this.base()}/units`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a unit by code. */
  async getUnit(unitCode: string, auth: AuthContext = SERVICE): Promise<Unit> {
    return this.ctx.http.request<Unit>({
      method: "GET",
      path: `${this.base()}/units/${encodeURIComponent(unitCode)}`,
      auth,
    });
  }

  /** Add a new unit. */
  async createUnit(input: UnitInput, auth: AuthContext = SERVICE): Promise<UnitCreated> {
    return this.ctx.http.request<UnitCreated>({ method: "POST", path: `${this.base()}/units`, auth, body: input });
  }

  /** Update a unit by code. */
  async updateUnit(unitCode: string, input: UnitUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/units/${encodeURIComponent(unitCode)}`,
      auth,
      body: input,
    });
  }

  /** Delete a unit by code. */
  async deleteUnit(unitCode: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/units/${encodeURIComponent(unitCode)}`,
      auth,
    });
  }

  /** Delete multiple units by code (bulk). */
  async deleteUnits(codes: string[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/units`,
      auth,
      query: { codes: codes.join(",") },
    });
  }

  /** Fetch a conversion factor (`PUT /units/conversion-factor-commands`). */
  async getConversionFactor(input: ConversionFactorInput, auth: AuthContext = SERVICE): Promise<ConversionFactorResult> {
    return this.ctx.http.request<ConversionFactorResult>({
      method: "PUT",
      path: `${this.base()}/units/conversion-factor-commands`,
      auth,
      body: input,
    });
  }

  /** Convert a value between units (`PUT /units/convert-unit-commands`). */
  async convertUnit(input: ConvertUnitInput, auth: AuthContext = SERVICE): Promise<ConvertUnitResult> {
    return this.ctx.http.request<ConvertUnitResult>({
      method: "PUT",
      path: `${this.base()}/units/convert-unit-commands`,
      auth,
      body: input,
    });
  }

  /** List all unit types. */
  async listUnitTypes(auth: AuthContext = SERVICE): Promise<unknown[]> {
    return this.ctx.http.request<unknown[]>({ method: "GET", path: `${this.base()}/types`, auth });
  }
}
```

> Type `listUnitTypes` to the generated `GET /types` response if named (replace
> `unknown[]` + export `UnitTypeList`). The `codes` bulk-delete query param name/
> format is pinned at codegen (adjust if not comma-joined `codes`).

Facade `src/unit-handling.ts`: `export * from "./services/unit-handling";`

MSW test `unit-handling.test.ts` (`BASE = "https://api.emporix.io/unit-handling/acme"`): listUnits/getUnit/createUnit (→ CreateUnitResponse)/updateUnit (204)/deleteUnit (204)/deleteUnits (assert `?codes=...`)/getConversionFactor/convertUnit (PUT, body+result)/listUnitTypes; `Bearer svc-tok`; `encodeURIComponent` on unitCode; 404 on get.

- [ ] **Step 3: Run unit tests + typecheck; commit (types, service).**

---

## Task 5: Wire all three onto EmporixClient

- [ ] **Step 1: Failing wiring test** — `admin-config-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { SepaExportService } from "../../src/services/sepa-export";
import { IndexingService } from "../../src/services/indexing";
import { UnitHandlingService } from "../../src/services/unit-handling";

describe("EmporixClient admin-config wiring", () => {
  it("exposes sepaExport, indexing, units", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.sepaExport).toBeInstanceOf(SepaExportService);
    expect(sdk.indexing).toBeInstanceOf(IndexingService);
    expect(sdk.units).toBeInstanceOf(UnitHandlingService);
  });
});
```

- [ ] **Step 2: Verify it fails.**

- [ ] **Step 3a: `ServiceName`** — add `| "sepa-export" | "indexing" | "unit-handling"` after `| "returns"`.
- [ ] **Step 3b: `client.ts`** — import the three services after `ReturnsService`; fields `readonly sepaExport: SepaExportService; readonly indexing: IndexingService; readonly units: UnitHandlingService;` after `returns`; construct `this.sepaExport = new SepaExportService(mk("sepa-export")); this.indexing = new IndexingService(mk("indexing")); this.units = new UnitHandlingService(mk("unit-handling"));`.
- [ ] **Step 3c: barrel** — after `export * from "./returns";`:
```ts
export * from "./sepa-export";
export * from "./indexing";
export * from "./unit-handling";
```

- [ ] **Step 4: Run wiring test, full suite, typecheck, build.**

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/admin-config-wiring.test.ts
git commit -m "feat(sdk): expose admin config services on the client"
```

---

## Task 6: Documentation

- [ ] **Step 1:** Create `docs/sepa-export.md`, `docs/indexing.md`, `docs/unit-handling.md` (each: server-side note, the methods with short snippets — for SEPA note `getFile` returns the raw file text).
- [ ] **Step 2: CLAUDE.md** — append `SepaExport, Indexing, UnitHandling` to the service list.
- [ ] **Step 3: Commit** — `docs(sdk): document the admin config services`.

---

## Task 7: Changeset

- [ ] **Step 1: `.changeset/admin-config-services.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix SEPA Export (`client.sepaExport`), Indexing (`client.indexing`), and
Unit Handling (`client.units`) bindings: SEPA export jobs + file retrieval;
search-index provider configurations + reindex; unit CRUD, unit types, and
conversion commands. Server-side only — these use the service (clientCredentials)
token.
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (adds `@viu/emporix-sdk`).
- [ ] **Step 3: Commit** — `chore(release): add admin config services changeset`.

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
```

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 full surface (sepa 3, indexing 8, unit 9) → Tasks 2-4 + tests. D2 three services one branch → Task 5. D3 no React / service-token → `const SERVICE` per method. D4 codegen + aliasing; SEPA `getFile` raw via `requestRaw` → `string` (Task 2). create responses distinct; updates/deletes/reindex → void (codegen-verify notes). Docs/changeset → Tasks 6/7 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO in code steps. Upstream-dependent uncertainties (UnitType `/types` response, update/reindex codes, bulk-delete `codes` param) are concrete codegen-verify notes with fallbacks.
- **Type consistency:** Public names per service identical across the types module, the service imports + re-exports, and the tests. Base paths `/sepa-export/${tenant}`, `/indexing/${tenant}`, `/unit-handling/${tenant}` match the spec + tests. Loggers `"sepa-export"`/`"indexing"`/`"unit-handling"` match `mk(...)` + the `ServiceName` additions. `errorFromResponse` imported in sepa for the raw getFile. Commit scopes `sdk`/`release`, lowercase verbs (commitlint-safe).
```
