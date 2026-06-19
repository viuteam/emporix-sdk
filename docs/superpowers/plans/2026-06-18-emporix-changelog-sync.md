# Emporix Changelog Sync (2026-06-18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the SDK in sync with the Emporix changelog as of 2026-06-18 — add the new indexing `reindex-jobs` API, mark every SDK-visible deprecated endpoint/field/service with `@deprecated`, regenerate entities from the re-fetched schemas (including wiring availability into the pipeline), and establish upstream version tracking (sync manifest + curated changelog doc).

**Architecture:** The existing codegen pipeline is unchanged in shape: `scripts/fetch-specs.ts` downloads OpenAPI specs into `specs/*.yml`, `scripts/generate.ts` (`@hey-api/openapi-ts`) emits `src/generated/<svc>/types.gen.ts` (never hand-edited), and hand-written service classes alias the generated types and add methods. Two additions: a machine-readable `specs/.sync-manifest.json` written by `fetch-specs.ts`, and a hand-maintained `docs/emporix-upstream-changelog.md`.

**Tech Stack:** TypeScript, `@hey-api/openapi-ts`, `tsx`, Vitest + MSW, pnpm workspaces, changesets. Spec: `docs/superpowers/specs/2026-06-18-emporix-changelog-sync-design.md`.

**Branch:** `feat/emporix-changelog-sync` (already created; the design spec is committed there).

**Commit conventions (commitlint):** allowed scopes include `sdk`, `availability`, `docs`. `indexing`/`approval` are *not* allowed scopes — use `sdk`. First word after the scope must be a lowercase verb. End every commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Authoritative facts (verified against upstream specs on 2026-06-18):**
- indexing: `POST /indexing/{tenant}/reindex` is `deprecated`; new `POST/GET /indexing/{tenant}/reindex-jobs` + `GET …/reindex-jobs/{reindexJobId}`. New schemas: `ReindexJob`, `ReindexRequest`, `ReindexEntityType`, `ReindexJobStatus`, `Metadata`. Old `Reindex` schema retained.
- ai-rag-indexer: `reindex` endpoint `deprecated`; `filter-metadata` fields `name`/`description` `deprecated`.
- sepa-export: all 3 endpoints `deprecated` (whole service). pick-pack: all 12 endpoints `deprecated` (whole service).
- approval: 3 `deprecated` fields (`Price.amount`, `itemYrn`, `ResourceItemPrice.amount`).
- availability: only the **location-management** endpoints are `deprecated` (not wrapped by the SDK). `get()` / `getMany()` target non-deprecated paths → **no endpoint change**.

---

## Task 1: Sync-manifest helper (pure, unit-tested)

A small dependency-light module with the pure logic the fetch script needs: hash a spec, read its `info.version`, and diff two manifests. Kept separate from `fetch-specs.ts` (which does network I/O) so it is unit-testable.

**Files:**
- Create: `packages/sdk/scripts/sync-manifest.ts`
- Test: `packages/sdk/tests/sync-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/sync-manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashSpec, readSpecVersion, diffManifest, type SyncManifest } from "../scripts/sync-manifest";

const entry = (sha256: string) => ({ url: "", specVersion: "", fetchedAt: "", sha256 });

describe("sync-manifest", () => {
  it("hashSpec is stable and content-sensitive", () => {
    expect(hashSpec("a")).toBe(hashSpec("a"));
    expect(hashSpec("a")).not.toBe(hashSpec("b"));
  });

  it("readSpecVersion reads info.version, '' when absent/empty", () => {
    expect(readSpecVersion("openapi: 3.0.0\ninfo:\n  title: X\n  version: v1\npaths:\n")).toBe("v1");
    expect(readSpecVersion("openapi: 3.0.0\ninfo:\n  title: X\n  version: ''\n")).toBe("");
    expect(readSpecVersion("openapi: 3.0.0\ninfo:\n  title: X\n")).toBe("");
  });

  it("diffManifest lists changed and new services, sorted", () => {
    const prev: SyncManifest = { generatedAt: "t0", services: { a: entry("1"), b: entry("x") } };
    const next: SyncManifest = { generatedAt: "t1", services: { a: entry("2"), b: entry("x"), c: entry("9") } };
    expect(diffManifest(prev, next)).toEqual(["a", "c"]);
  });

  it("diffManifest returns [] when there is no prior manifest", () => {
    expect(diffManifest(null, { generatedAt: "t", services: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/sync-manifest.test.ts`
Expected: FAIL — cannot resolve `../scripts/sync-manifest`.

- [ ] **Step 3: Write the implementation**

Create `packages/sdk/scripts/sync-manifest.ts`:

```ts
import { createHash } from "node:crypto";

/** One vendored spec's provenance in the sync manifest. */
export interface SpecManifestEntry {
  url: string;
  /** `info.version` from the spec (often "" upstream). */
  specVersion: string;
  /** ISO-8601 timestamp of the fetch run that vendored this spec. */
  fetchedAt: string;
  /** sha256 (hex) of the fetched YAML bytes — the change watermark. */
  sha256: string;
}

/** The machine-readable record of which upstream specs are vendored, and when. */
export interface SyncManifest {
  generatedAt: string;
  services: Record<string, SpecManifestEntry>;
}

/** sha256 hex of a spec's raw text. */
export function hashSpec(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Extract `info.version` from a raw OpenAPI YAML — the first two-space-indented
 * `version:` key (which sits under the top-level `info:` block). Returns "" when
 * absent or empty. Informational only; a regex keeps this dependency-free.
 */
export function readSpecVersion(yaml: string): string {
  const m = yaml.match(/^ {2}version:\s*(.*)$/m);
  if (!m) return "";
  return m[1].trim().replace(/^['"]|['"]$/g, "");
}

/** Service names whose sha256 is new or differs between `prev` and `next`, sorted. */
export function diffManifest(prev: SyncManifest | null, next: SyncManifest): string[] {
  if (!prev) return [];
  const changed: string[] = [];
  for (const [name, entry] of Object.entries(next.services)) {
    const before = prev.services[name];
    if (!before || before.sha256 !== entry.sha256) changed.push(name);
  }
  return changed.sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/sync-manifest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/sync-manifest.ts packages/sdk/tests/sync-manifest.test.ts
git commit -m "$(cat <<'EOF'
feat(sdk): add spec sync-manifest helper

Pure hash/version/diff helpers backing the upstream version watermark
written by fetch-specs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire manifest + availability into fetch-specs, run full re-sync, commit vendored artifacts

Add availability to the fetched specs, have `fetch-specs.ts` write `.sync-manifest.json` and report what changed, then run the full fetch + generate and commit the regenerated specs/types/manifest.

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Generated/vendored (by running the scripts): `packages/sdk/specs/*.yml`, `packages/sdk/specs/.sync-manifest.json`, `packages/sdk/src/generated/**`

- [ ] **Step 1: Add availability to the `SPECS` map**

In `packages/sdk/scripts/fetch-specs.ts`, add this entry to the `SPECS` object (place it next to the other `configuration`/`orders` services, after the `iam` entry):

```ts
  availability: `${BASE}/orders/availability/api-reference/api.yml`,
```

- [ ] **Step 2: Import the manifest helpers and `readFile`**

Change the top imports of `fetch-specs.ts` from:

```ts
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
```

to:

```ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashSpec,
  readSpecVersion,
  diffManifest,
  type SyncManifest,
  type SpecManifestEntry,
} from "./sync-manifest";
```

- [ ] **Step 3: Replace `main()` with the manifest-writing version**

Replace the existing `main()` function in `fetch-specs.ts` with:

```ts
async function readManifest(path: string): Promise<SyncManifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SyncManifest;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "specs");
  await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, ".sync-manifest.json");
  const prev = await readManifest(manifestPath);
  const now = new Date().toISOString();
  const services: Record<string, SpecManifestEntry> = {};
  for (const [name, url] of Object.entries(SPECS)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${name} spec: ${res.status} ${url}`);
    const yaml = await res.text();
    await writeFile(join(dir, `${name}.yml`), yaml, "utf8");
    services[name] = { url, specVersion: readSpecVersion(yaml), fetchedAt: now, sha256: hashSpec(yaml) };
    console.log(`fetched ${name} (${yaml.length} bytes)`);
  }
  const next: SyncManifest = { generatedAt: now, services };
  const changed = diffManifest(prev, next);
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  if (!prev) {
    console.log(`wrote initial sync manifest (${Object.keys(services).length} services)`);
  } else if (changed.length) {
    console.log(`changed since last vendored: ${changed.join(", ")}`);
  } else {
    console.log("no spec changes since last vendored");
  }
}
```

- [ ] **Step 4: Run the full fetch**

Run: `pnpm -F @viu/emporix-sdk fetch:specs`
Expected: a `fetched <name>` line per service (now including `fetched availability`), ending with `wrote initial sync manifest (38 services)`. Confirms the script parses and runs.

- [ ] **Step 5: Confirm the manifest and availability spec landed**

Run: `node -e "const m=require('./packages/sdk/specs/.sync-manifest.json'); console.log('services:', Object.keys(m.services).length); console.log('availability:', !!m.services['availability']); console.log('indexing-service:', !!m.services['indexing-service'])"`
Expected: `services: 38`, `availability: true`, `indexing-service: true`.

Run: `grep -c "reindex-jobs" packages/sdk/specs/indexing-service.yml`
Expected: a non-zero count (the new endpoint is in the re-fetched spec).

- [ ] **Step 6: Regenerate types**

Run: `pnpm -F @viu/emporix-sdk generate`
Expected: `generated <name>` per spec, including `generated availability` and `generated indexing-service`.

- [ ] **Step 7: Confirm the new indexing entities were generated**

Run: `grep -nE "export type (ReindexJob|ReindexRequest|ReindexEntityType|ReindexJobStatus)\b" packages/sdk/src/generated/indexing-service/types.gen.ts`
Expected: all four exported types are present. **If any name differs, note the actual exported name** — Tasks 4–5 alias these and must use the real names.

- [ ] **Step 8: Review the diff scope and verify the build stays green**

Run: `git status --short packages/sdk/specs packages/sdk/src/generated | head -40`
Run: `git diff --stat packages/sdk/src/generated | tail -20`

A full re-fetch may surface unrelated upstream drift in other services. Then run:

Run: `pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk test`
Expected: all green.

If an *unrelated* service's regenerated types break typecheck/build (upstream drift outside this plan's scope), **stop and surface it** — do not silently patch unrelated services. Report which service broke and how, and confirm scope before continuing.

- [ ] **Step 9: Commit the re-sync**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs packages/sdk/src/generated
git commit -m "$(cat <<'EOF'
chore(sdk): re-sync vendored emporix specs and add sync manifest

Add availability to fetch-specs, re-fetch all specs, regenerate types,
and write specs/.sync-manifest.json (url + info.version + fetchedAt +
sha256 per service) so future syncs can report what changed since when.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Indexing reindex-jobs public type aliases

Alias the regenerated indexing entities to stable public names and deprecate the legacy `ReindexInput`.

**Files:**
- Modify: `packages/sdk/src/services/indexing-types.ts`

- [ ] **Step 1: Replace the file contents**

Replace the entire body of `packages/sdk/src/services/indexing-types.ts` with:

```ts
/**
 * Public types for the Indexing Service — stable names aliased over the
 * generated `indexing-service` types.
 */
import type {
  IndexConfiguration,
  IndexCreationResponse,
  IndexPublicConfiguration,
  Reindex,
  ReindexJob as GenReindexJob,
  ReindexRequest,
  ReindexEntityType as GenReindexEntityType,
  ReindexJobStatus as GenReindexJobStatus,
} from "../generated/indexing-service";

/** An indexing configuration (read + write body). */
export type IndexConfig = IndexConfiguration;
/** `POST /configurations` response. */
export type IndexConfigCreated = IndexCreationResponse;
/** A public indexing configuration. */
export type IndexPublicConfig = IndexPublicConfiguration;

/** A reindex job — tracks the progress of a `FULL` reindex. */
export type ReindexJob = GenReindexJob;
/** Body for `createReindexJob`: `{ entityType, rag? }` (`entityType` required). */
export type ReindexJobInput = ReindexRequest;
/** Entity type to reindex — `"PRODUCT"` or a custom schema type. */
export type ReindexEntityType = GenReindexEntityType;
/** Lifecycle status of a {@link ReindexJob}. */
export type ReindexJobStatus = GenReindexJobStatus;

/**
 * Body for the legacy `reindex` endpoint.
 * @deprecated since 2026-06-18, removal 2026-12-01 — use {@link ReindexJobInput} with
 * `IndexingService.createReindexJob`.
 */
export type ReindexInput = Reindex;
```

> If Task 2 Step 7 reported different generated names, substitute them in the `import` above.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS (no usage yet; this just confirms the aliases resolve against the regenerated module).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/services/indexing-types.ts
git commit -m "$(cat <<'EOF'
feat(sdk): add reindex-job public types for indexing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Indexing reindex-jobs methods (TDD)

Add `createReindexJob`, `listReindexJobs`, `getReindexJob` to `IndexingService`.

**Files:**
- Test: `packages/sdk/tests/indexing.test.ts`
- Modify: `packages/sdk/src/services/indexing.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/indexing.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../src/client";

const TENANT = "acme";
const job = {
  id: "job1",
  status: "IN_PROGRESS",
  entityType: "PRODUCT",
  metadata: { createdAt: "2026-06-16T12:32:14.132Z", modifiedAt: "2026-06-16T12:32:14.150Z" },
};

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc", token_type: "Bearer", expires_in: 3600 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function sdk() {
  return new EmporixClient({
    tenant: TENANT,
    credentials: { backend: { clientId: "b", secret: "s" } },
    logger: false,
  });
}

describe("IndexingService reindex jobs", () => {
  it("createReindexJob posts the body and returns the job (201)", async () => {
    let received: unknown;
    server.use(
      http.post(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(job, { status: 201 });
      }),
    );
    const res = await sdk().indexing.createReindexJob({ entityType: "PRODUCT", rag: true });
    expect(received).toEqual({ entityType: "PRODUCT", rag: true });
    expect(res.id).toBe("job1");
    expect(res.status).toBe("IN_PROGRESS");
  });

  it("createReindexJob handles the 200 already-in-progress response", async () => {
    server.use(
      http.post(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs`, () =>
        HttpResponse.json(job, { status: 200 }),
      ),
    );
    const res = await sdk().indexing.createReindexJob({ entityType: "PRODUCT" });
    expect(res.id).toBe("job1");
  });

  it("listReindexJobs returns a PaginatedItems shape", async () => {
    server.use(
      http.get(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs`, () =>
        HttpResponse.json([job]),
      ),
    );
    const page = await sdk().indexing.listReindexJobs({ pageSize: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(50);
    expect(page.hasNextPage).toBe(false);
  });

  it("getReindexJob fetches one job by id", async () => {
    server.use(
      http.get(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs/job1`, () =>
        HttpResponse.json(job),
      ),
    );
    const res = await sdk().indexing.getReindexJob("job1");
    expect(res.entityType).toBe("PRODUCT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/indexing.test.ts`
Expected: FAIL — `sdk().indexing.createReindexJob is not a function`.

- [ ] **Step 3: Update imports/exports in `indexing.ts`**

In `packages/sdk/src/services/indexing.ts`, replace the first three lines:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { IndexConfig, IndexConfigCreated, IndexPublicConfig, ReindexInput } from "./indexing-types";
export type { IndexConfig, IndexConfigCreated, IndexPublicConfig, ReindexInput } from "./indexing-types";
```

with:

```ts
import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  IndexConfig,
  IndexConfigCreated,
  IndexPublicConfig,
  ReindexInput,
  ReindexJob,
  ReindexJobInput,
} from "./indexing-types";
export type {
  IndexConfig,
  IndexConfigCreated,
  IndexPublicConfig,
  ReindexInput,
  ReindexJob,
  ReindexJobInput,
  ReindexEntityType,
  ReindexJobStatus,
} from "./indexing-types";

/** Options for {@link IndexingService.listReindexJobs}. */
export interface ListReindexJobsOptions {
  pageNumber?: number;
  pageSize?: number;
  /** Raw Emporix `q` filter string. */
  q?: string;
}
```

- [ ] **Step 4: Add the three methods**

In `packages/sdk/src/services/indexing.ts`, immediately **before** the existing `/** Trigger a reindex. */` block (the `reindex` method), insert:

```ts
  /**
   * Create a reindex job (replaces {@link reindex}). A `FULL` reindex of the
   * given `entityType`; set `rag: true` to also rebuild the RAG vector index
   * (PRODUCT only). Resolves to the created job (`201`) or, when a job for that
   * `entityType` is already `IN_PROGRESS`, that running job (`200`).
   */
  async createReindexJob(input: ReindexJobInput, auth: AuthContext = SERVICE): Promise<ReindexJob> {
    return this.ctx.http.request<ReindexJob>({
      method: "POST",
      path: `${this.base()}/reindex-jobs`,
      auth,
      body: input,
    });
  }

  /** List reindex jobs (paginated). */
  async listReindexJobs(
    opts: ListReindexJobsOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<ReindexJob>> {
    const pageNumber = opts.pageNumber ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const query: Record<string, string | number | undefined> = { pageNumber, pageSize };
    if (opts.q !== undefined) query.q = opts.q;
    const items = await this.ctx.http.request<ReindexJob[]>({
      method: "GET",
      path: `${this.base()}/reindex-jobs`,
      query,
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Fetch one reindex job by id. */
  async getReindexJob(reindexJobId: string, auth: AuthContext = SERVICE): Promise<ReindexJob> {
    return this.ctx.http.request<ReindexJob>({
      method: "GET",
      path: `${this.base()}/reindex-jobs/${encodeURIComponent(reindexJobId)}`,
      auth,
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/indexing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/indexing.ts packages/sdk/tests/indexing.test.ts
git commit -m "$(cat <<'EOF'
feat(sdk): add indexing reindex-jobs methods

createReindexJob / listReindexJobs / getReindexJob over
/indexing/{tenant}/reindex-jobs, the replacement for the deprecated
reindex endpoint.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Deprecation JSDoc sweep

Mark every remaining SDK-visible deprecated surface. All changes are JSDoc-only (no runtime change); verified by build + grep.

**Files:**
- Modify: `packages/sdk/src/services/indexing.ts`
- Modify: `packages/sdk/src/services/ai-rag-indexer.ts`
- Modify: `packages/sdk/src/services/sepa-export.ts`
- Modify: `packages/sdk/src/services/pick-pack.ts`
- Modify: `packages/sdk/src/services/approval-types.ts`

- [ ] **Step 1: Deprecate `IndexingService.reindex`**

In `packages/sdk/src/services/indexing.ts`, replace the `reindex` method's doc comment:

```ts
  /** Trigger a reindex. */
```

with:

```ts
  /**
   * Trigger a reindex.
   * @deprecated since 2026-06-18, removal 2026-12-01 — use {@link createReindexJob}
   * (`createReindexJob({ entityType: "PRODUCT" })`), which returns a trackable job.
   */
```

- [ ] **Step 2: Deprecate `RagIndexerService.reindex`**

In `packages/sdk/src/services/ai-rag-indexer.ts`, find the `reindex` method's doc comment that begins `* Schedule a full async re-index for \`type\`` and append a `@deprecated` line as its last line (before the closing `*/`):

```ts
   * @deprecated since 2026-06-18, removal 2026-12-01 — use the indexing service:
   * `client.indexing.createReindexJob({ entityType: "PRODUCT", rag: true })`.
```

- [ ] **Step 3: Deprecate `SepaExportService` (whole service)**

In `packages/sdk/src/services/sepa-export.ts`, replace the class doc comment:

```ts
/**
 * Emporix SEPA Export Service (`/sepa-export/{tenant}/…`): export jobs and file
 * retrieval. Server-side; defaults to the service token.
 */
export class SepaExportService {
```

with:

```ts
/**
 * Emporix SEPA Export Service (`/sepa-export/{tenant}/…`): export jobs and file
 * retrieval. Server-side; defaults to the service token.
 *
 * @deprecated since 2026-05-25, removal 2026-08-24 — the SEPA Export service is
 * being sunset by Emporix; all endpoints are no longer maintained.
 */
export class SepaExportService {
```

- [ ] **Step 4: Deprecate `PickPackService` (whole service)**

In `packages/sdk/src/services/pick-pack.ts`, replace the class doc comment:

```ts
/**
 * Emporix Pick-Pack Service (`/pick-pack/{tenant}/…`): fulfillment/packlist
 * orders, assignees, packaging, packing events, and recalculation jobs.
 * Server-side; defaults to the service token. Several mutating endpoints return
 * an acknowledgement (`{ message?, code? }`).
 */
export class PickPackService {
```

with:

```ts
/**
 * Emporix Pick-Pack Service (`/pick-pack/{tenant}/…`): fulfillment/packlist
 * orders, assignees, packaging, packing events, and recalculation jobs.
 * Server-side; defaults to the service token. Several mutating endpoints return
 * an acknowledgement (`{ message?, code? }`).
 *
 * @deprecated since 2026-05-25, removal 2026-08-24 — the Pick-Pack service is
 * being sunset by Emporix; all endpoints are no longer maintained.
 */
export class PickPackService {
```

- [ ] **Step 5: Document approval deprecated fields**

In `packages/sdk/src/services/approval-types.ts`, replace the top doc comment:

```ts
/**
 * Public types for the Approval Service — stable names aliased over the generated
 * `approval-service` types (single source of truth; faithful required/optional flags).
 *
 * Every endpoint is CustomerAccessToken-only (B2B cart/quote approval workflows).
 */
```

with:

```ts
/**
 * Public types for the Approval Service — stable names aliased over the generated
 * `approval-service` types (single source of truth; faithful required/optional flags).
 *
 * Every endpoint is CustomerAccessToken-only (B2B cart/quote approval workflows).
 *
 * Deprecated upstream (since 2026-05-26, removal 2026-11-30) — these fields carry
 * `@deprecated` in the generated types; prefer the replacements:
 * - `totalPrice.amount` / `subTotalPrice.amount` → `netValue` / `grossValue` / `taxValue`
 * - `itemYrn` → `itemId`
 * - `itemPrice.amount` → `calculatedPrice` and `unitPrice`
 */
```

- [ ] **Step 6: Verify build + the deprecations are present**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: PASS.

Run: `grep -c "@deprecated" packages/sdk/src/services/indexing.ts packages/sdk/src/services/ai-rag-indexer.ts packages/sdk/src/services/sepa-export.ts packages/sdk/src/services/pick-pack.ts packages/sdk/src/services/approval-types.ts`
Expected: each file reports at least 1.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/indexing.ts packages/sdk/src/services/ai-rag-indexer.ts packages/sdk/src/services/sepa-export.ts packages/sdk/src/services/pick-pack.ts packages/sdk/src/services/approval-types.ts
git commit -m "$(cat <<'EOF'
feat(sdk): deprecate legacy reindex, sepa-export, pick-pack and approval fields

Mark the deprecated indexing.reindex / ragIndexer.reindex methods, the
whole SepaExport and PickPack services, and the deprecated approval price
fields with @deprecated + migration pointers and removal dates.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Availability — alias layer + import reconciliation (no endpoint change)

Decouple the availability service's public `Availability` type from the regenerated module via an alias file, the same pattern the other services use. **No endpoint or signature change** — `get()`/`getMany()` already target non-deprecated paths.

**Files:**
- Create: `packages/sdk/src/services/availability-types.ts`
- Modify: `packages/sdk/src/services/availability.ts`

- [ ] **Step 1: Confirm the regenerated availability type name**

Run: `grep -nE "export type AvailabilityWithBundle\b" packages/sdk/src/generated/availability/types.gen.ts`
Expected: present. **If the name differs**, use the actual name in Step 2.

- [ ] **Step 2: Create the alias file**

Create `packages/sdk/src/services/availability-types.ts`:

```ts
/**
 * Public types for the Availability Service — stable names aliased over the
 * generated `availability` types. The single-product GET and the batch search
 * both return the bundle-aware variant; there is no restock-date field.
 *
 * Note: only the availability *location-management* endpoints are deprecated
 * upstream (removal 2026-09-01); the SDK does not wrap those. The product
 * availability endpoints used here are current.
 */
import type { AvailabilityWithBundle } from "../generated/availability";

/** A product's availability record (bundle-aware). */
export type Availability = AvailabilityWithBundle;
```

- [ ] **Step 3: Re-point the service import (proven `indexing.ts` pattern)**

In `packages/sdk/src/services/availability.ts`, replace the generated import line:

```ts
import type { AvailabilityWithBundle } from "../generated/availability";
```

with an import + re-export from the alias file (this brings `Availability` into local scope for the method signatures *and* re-exports it for consumers — the same shape `indexing.ts` uses; `export … from` creates no local binding, so there is no duplicate identifier):

```ts
import type { Availability } from "./availability-types";
export type { Availability } from "./availability-types";
```

then **delete** the now-redundant local alias line entirely:

```ts
export type Availability = AvailabilityWithBundle;
```

> Rationale: `get()`/`getMany()` already reference the name `Availability`; sourcing it from the alias file leaves every method body untouched, and the `export … from` keeps `Availability` part of the service module's public surface.

- [ ] **Step 4: Verify typecheck + tests**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS. If the regenerated `AvailabilityWithBundle` shape lacks `productId` / `site` / `available` used in `getMany`'s synthesized fallback, **stop and surface it** — the upstream shape changed and the fallback needs reconciling; report before adapting.

Run: `pnpm -F @viu/emporix-sdk exec vitest run`
Expected: existing availability behaviour unchanged; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/availability-types.ts packages/sdk/src/services/availability.ts
git commit -m "$(cat <<'EOF'
refactor(availability): alias public type over regenerated module

Add availability-types.ts so the public Availability type is decoupled
from the (now upstream-vendored) generated names. No endpoint change —
the product availability endpoints are not deprecated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Curated upstream changelog doc

The human-readable record of what changed upstream and how the SDK responded.

**Files:**
- Create: `docs/emporix-upstream-changelog.md`

- [ ] **Step 1: Create the doc**

Create `docs/emporix-upstream-changelog.md`:

```md
# Emporix Upstream Changelog (SDK sync log)

Tracks which Emporix changelog entries (<https://developer.emporix.io/changelog>) have been
folded into this SDK, and when. The machine-readable companion is
`packages/sdk/specs/.sync-manifest.json` (per-service `sha256` + `fetchedAt`); run
`pnpm -F @viu/emporix-sdk fetch:specs` to see `changed since last vendored: …`.

## 2026-06-18 — synced (reindex-jobs migration + deprecation sweep)

Baseline sync; vendored all 38 specs and wrote the initial sync manifest.

### Endpoints

- **indexing** — `POST /indexing/{tenant}/reindex` deprecated (removal **2026-12-01**); new
  `POST /indexing/{tenant}/reindex-jobs` (+ `GET …/reindex-jobs`, `GET …/reindex-jobs/{id}`).
  SDK: added `indexing.createReindexJob` / `listReindexJobs` / `getReindexJob`; `@deprecated`
  on `indexing.reindex`.
- **ai-rag-indexer** — `reindex` deprecated (removal **2026-12-01**) → use indexing
  `reindex-jobs` with `rag: true`. `filter-metadata` response fields `name`/`description`
  deprecated. SDK: `@deprecated` on `ragIndexer.reindex` (already noted on the filter fields).

### Whole services

- **sepa-export** — all endpoints deprecated (removal **2026-08-24**). SDK: `@deprecated` on
  `SepaExportService`.
- **pick-pack** — all endpoints deprecated (removal **2026-08-24**). SDK: `@deprecated` on
  `PickPackService`.

### Fields

- **approval** — `totalPrice.amount`, `subTotalPrice.amount`, `itemYrn`, `itemPrice.amount`
  deprecated (removal **2026-11-30**) → `netValue`/`grossValue`/`taxValue`, `itemId`,
  `calculatedPrice`+`unitPrice`. SDK: carried via generated `@deprecated`; documented in
  `approval-types.ts`.

### Tracked, no SDK action

- **availability** — only the *location-management* endpoints are deprecated (removal
  **2026-09-01**); the SDK does not wrap them. The product availability endpoints used by
  `availability.get` / `getMany` are current (the availability spec is now fetched + vendored).
- **supplier** — whole service deprecated (removal **2026-09-01**). No SDK surface.
- **iam** — roles/permissions/resources model deprecated (removal **2026-10-01**). No SDK
  surface (the iam spec is vendored but not wrapped).
```

- [ ] **Step 2: Commit**

```bash
git add docs/emporix-upstream-changelog.md
git commit -m "$(cat <<'EOF'
docs(docs): add emporix upstream changelog sync log

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Changeset + final verification

**Files:**
- Create: `.changeset/emporix-changelog-sync.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/emporix-changelog-sync.md`:

```md
---
"@viu/emporix-sdk": minor
---

Sync with the Emporix changelog (2026-06-18). New indexing reindex-jobs API:
`indexing.createReindexJob`, `indexing.listReindexJobs`, `indexing.getReindexJob`
(replacing the now-deprecated `indexing.reindex`). Deprecated `ragIndexer.reindex`
(use `indexing.createReindexJob({ entityType: "PRODUCT", rag: true })`), the whole
`SepaExportService` and `PickPackService`, and the deprecated approval price fields.
Availability is now fetched + vendored through the codegen pipeline. Adds upstream
version tracking: `specs/.sync-manifest.json` (written by `fetch-specs`) plus
`docs/emporix-upstream-changelog.md`.
```

- [ ] **Step 2: Full verification gate**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: PASS.

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (includes `sync-manifest` + `indexing` suites).

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS.

Run: `pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS (React consumes the SDK `dist/`; confirms no break downstream).

- [ ] **Step 3: Commit**

```bash
git add .changeset/emporix-changelog-sync.md
git commit -m "$(cat <<'EOF'
chore(release): add changeset for emporix changelog sync

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Finish the branch**

Invoke the `superpowers:finishing-a-development-branch` skill to choose how to integrate `feat/emporix-changelog-sync` (PR against `main` per the repo's changeset flow).

---

## Self-Review notes

- **Spec coverage:** reindex-jobs API (Tasks 3–4), legacy reindex deprecation (Task 5), rag/sepa/pick-pack/approval deprecations (Task 5), availability wiring + reconciliation (Tasks 2 + 6), sync manifest (Tasks 1–2), curated doc (Task 7), tests + changeset (Tasks 4, 8) — all covered.
- **Type consistency:** `ReindexJob` / `ReindexJobInput` / `ReindexEntityType` / `ReindexJobStatus` named identically in Tasks 3–4; `ListReindexJobsOptions` defined and used in Task 4; `PaginatedItems` imported in Task 4. Method names `createReindexJob`/`listReindexJobs`/`getReindexJob` consistent across Tasks 4, 5, 7, 8.
- **Known dependency on regen:** Tasks 3, 4, 6 reference generated names that only exist after Task 2; Task 2 Step 7 and Task 6 Step 1 verify the actual names and instruct substitution if they differ.
```
