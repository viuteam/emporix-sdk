# `@viu/emporix-mixins` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `@viu/emporix-mixins` — a generic, tenant-agnostic toolkit to resolve Emporix mixins into typed values and keep those types in sync with the Schema Service.

**Architecture:** Three units in one package: a structural runtime accessor (`readMixin`/`writeMixin`/`validateMixin`/`savedMixinVersion`), pluggable `MixinSource` adapters (default `schemaService`), and a config-driven CLI (`pull`/`generate`/`check`). No tenant data lives in the package; all tenant-specific artifacts are generated into the consumer repo. Two entrypoints: `.` (runtime, light) and `./codegen` (build-time, heavy) + an `emporix-mixins` bin.

**Tech Stack:** TypeScript (strict, ESM+CJS via tsup), Vitest + MSW, `json-schema-to-typescript` (codegen), `ajv` (optional lazy runtime validation), `jiti` (config loader), pnpm.

**Spec:** `docs/superpowers/specs/2026-06-08-emporix-mixins-design.md`.

**Implementation refinement vs spec:** `validateMixin` is **async** (`Promise<…>`) and lazy-`import("ajv")`s, so the runtime `.` entry stays browser-safe (no `node:module`, no eager ajv). `readMixin` is therefore **sync without a `{ validate }` option** — validate explicitly via `await validateMixin(...)`. This satisfies the "runtime validation" requirement without making reads async.

**Phasing note:** this plan ships the `schemaService` (default), `localFiles`, and `cdnManifest` adapters. `terraformOutput` is a deferred additive adapter (same `MixinSource` interface; needs the `terraform` binary) — out of this plan, logged here so it isn't silently dropped.

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/mixins/package.json`, `packages/mixins/tsconfig.json`, `packages/mixins/tsup.config.ts`, `packages/mixins/vitest.config.ts`, `packages/mixins/src/index.ts`, `packages/mixins/src/codegen.ts`

- [ ] **Step 1: `package.json`**

```jsonc
{
  "name": "@viu/emporix-mixins",
  "version": "0.0.0",
  "description": "Generic toolkit to resolve and sync Emporix mixins as typed values.",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20.19.0" },
  "exports": {
    ".":         { "types": "./dist/index.d.ts",   "import": "./dist/index.js",   "require": "./dist/index.cjs" },
    "./codegen": { "types": "./dist/codegen.d.ts", "import": "./dist/codegen.js", "require": "./dist/codegen.cjs" },
    "./package.json": "./package.json"
  },
  "bin": { "emporix-mixins": "./dist/cli.js" },
  "files": ["dist"],
  "scripts": { "build": "tsup", "test": "vitest run --coverage", "lint": "eslint src", "typecheck": "tsc --noEmit" },
  "dependencies": { "jiti": "^2.4.0" },
  "optionalDependencies": { "json-schema-to-typescript": "^15.0.0" },
  "peerDependencies": { "@viu/emporix-sdk": "workspace:^", "ajv": "^8.0.0" },
  "peerDependenciesMeta": { "@viu/emporix-sdk": { "optional": true }, "ajv": { "optional": true } },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "@viu/emporix-sdk": "workspace:*",
    "ajv": "^8.0.0",
    "eslint": "^9.0.0",
    "json-schema-to-typescript": "^15.0.0",
    "msw": "^2.4.0",
    "tsup": "^8.2.0",
    "typescript": "^5.6.0"
  },
  "publishConfig": { "access": "public" }
}
```

- [ ] **Step 2: `tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"], "resolveJsonModule": true },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", codegen: "src/codegen.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["@viu/emporix-sdk", "ajv", "json-schema-to-typescript", "jiti"],
});
```

- [ ] **Step 4: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/codegen.ts", "src/cli.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

- [ ] **Step 5: Empty entrypoints (so the build wiring is real)**

`src/index.ts`:
```ts
export {};
```
`src/codegen.ts`:
```ts
export {};
```
`src/cli.ts`:
```ts
export {};
```

- [ ] **Step 6: Install + build to verify wiring**

Run:
```bash
pnpm install
pnpm -F @viu/emporix-mixins build
```
Expected: `pnpm install` links the new workspace package; build emits `dist/{index,codegen,cli}.{js,cjs,d.ts}`.

- [ ] **Step 7: Commit**

```bash
git add packages/mixins
git commit -m "feat(repo): scaffold @viu/emporix-mixins package"
```

---

## Task 2: Runtime accessor

**Files:**
- Create: `packages/mixins/src/runtime/types.ts`, `src/runtime/version.ts`, `src/runtime/write.ts`, `src/runtime/read.ts`, `src/runtime/validate.ts`
- Modify: `packages/mixins/src/index.ts`
- Test: `packages/mixins/tests/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mixins/tests/runtime.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { readMixin, writeMixin, validateMixin, savedMixinVersion } from "../src/index";
import type { MixinDescriptor } from "../src/index";

const D: MixinDescriptor<{ packaging?: string }> = {
  key: "deliveryOptions",
  entity: "CUSTOMER",
  url: "https://cdn/deliveryOptionsMixIn.v6.json",
  version: 6,
  schema: { type: "object", properties: { packaging: { type: "string" } }, additionalProperties: false },
};

describe("runtime accessor", () => {
  it("writeMixin sets mixins[key] and metadata.mixins[key]=url", () => {
    const body = writeMixin({}, D, { packaging: "Paper" });
    expect(body.mixins).toEqual({ deliveryOptions: { packaging: "Paper" } });
    expect(body.metadata).toEqual({ mixins: { deliveryOptions: D.url } });
  });

  it("readMixin returns the typed value or undefined", () => {
    const entity = writeMixin({}, D, { packaging: "Paper" });
    expect(readMixin(entity, D)?.packaging).toBe("Paper");
    expect(readMixin({}, D)).toBeUndefined();
  });

  it("savedMixinVersion parses the version from metadata.mixins url", () => {
    expect(savedMixinVersion({ metadata: { mixins: { deliveryOptions: "x/foo.v3.json" } } }, "deliveryOptions")).toBe(3);
    expect(savedMixinVersion({ metadata: { mixins: { deliveryOptions: "x/foo.v3" } } }, "deliveryOptions")).toBe(3);
    expect(savedMixinVersion({}, "deliveryOptions")).toBeUndefined();
  });

  it("readMixin warns when the saved version differs from the descriptor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entity = { mixins: { deliveryOptions: {} }, metadata: { mixins: { deliveryOptions: "x/foo.v5.json" } } };
    readMixin(entity, D);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("validateMixin validates against the schema (lazy ajv)", async () => {
    expect(await validateMixin({ packaging: "Paper" }, D)).toEqual({ valid: true });
    const bad = await validateMixin({ packaging: 42 }, D);
    expect(bad.valid).toBe(false);
    expect(bad.errors?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-mixins test runtime`
Expected: FAIL — exports not found.

- [ ] **Step 3: `src/runtime/types.ts`**

```ts
export type JsonSchema = Record<string, unknown>;

/** Structural shape every Emporix entity matches — no tenant/entity knowledge needed. */
export interface HasMixins {
  mixins?: Record<string, unknown>;
  metadata?: { mixins?: Record<string, string> };
}

/** Identifies one mixin and how to resolve it. Generated per tenant, consumed by the runtime. */
export interface MixinDescriptor<T = unknown> {
  key: string;
  entity: string;
  url: string;
  version: number;
  schema?: JsonSchema;
  readonly __type?: T;
}
```

- [ ] **Step 4: `src/runtime/version.ts`**

```ts
import type { HasMixins } from "./types";

/** Parses the version from the entity's `metadata.mixins[key]` URL (e.g. `…MixIn.v6.json` → 6). */
export function savedMixinVersion(entity: HasMixins, key: string): number | undefined {
  const url = entity.metadata?.mixins?.[key];
  const m = url?.match(/\.v(\d+)(?:\.\w+)?$/);
  return m ? Number(m[1]) : undefined;
}
```

- [ ] **Step 5: `src/runtime/write.ts`**

```ts
import type { HasMixins, MixinDescriptor } from "./types";

/** Sets `mixins[key]=value` AND `metadata.mixins[key]=descriptor.url` on a (partial) body. */
export function writeMixin<T, B extends object>(
  body: B,
  d: MixinDescriptor<T>,
  value: T,
): B & HasMixins {
  const b = body as B & HasMixins;
  return {
    ...b,
    mixins: { ...(b.mixins ?? {}), [d.key]: value },
    metadata: { ...(b.metadata ?? {}), mixins: { ...(b.metadata?.mixins ?? {}), [d.key]: d.url } },
  };
}
```

- [ ] **Step 6: `src/runtime/read.ts`**

```ts
import type { HasMixins, MixinDescriptor } from "./types";
import { savedMixinVersion } from "./version";

/**
 * Reads a typed mixin off any entity. Returns `undefined` when absent. Emits a
 * `console.warn` when the entity's saved version differs from the descriptor
 * (drift signal). Never throws. Validate explicitly via `validateMixin`.
 */
export function readMixin<T>(entity: HasMixins, d: MixinDescriptor<T>): T | undefined {
  const value = entity.mixins?.[d.key] as T | undefined;
  if (value === undefined) return undefined;
  const saved = savedMixinVersion(entity, d.key);
  if (saved !== undefined && saved !== d.version) {
    // eslint-disable-next-line no-console
    console.warn(
      `[emporix-mixins] "${d.key}": entity carries v${saved} but the loaded type is v${d.version}`,
    );
  }
  return value;
}
```

- [ ] **Step 7: `src/runtime/validate.ts`**

```ts
import type { MixinDescriptor } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validates a value against the descriptor's JSON Schema using `ajv`. Async +
 * lazy-imported so the runtime entry stays browser-safe and ajv-free unless
 * validation is actually used. No schema → always valid.
 */
export async function validateMixin<T>(
  value: unknown,
  d: MixinDescriptor<T>,
): Promise<ValidationResult> {
  if (!d.schema) return { valid: true };
  let AjvCtor: new (opts?: unknown) => {
    compile: (s: unknown) => ((v: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
  };
  try {
    const mod = (await import("ajv")) as { default: typeof AjvCtor };
    AjvCtor = mod.default;
  } catch {
    throw new Error(
      "[emporix-mixins] validation needs the optional peer 'ajv'. Install it: pnpm add ajv",
    );
  }
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  const validate = ajv.compile(d.schema);
  const ok = validate(value);
  if (ok) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? "invalid"}`.trim()),
  };
}
```

- [ ] **Step 8: `src/index.ts`**

```ts
export type { JsonSchema, HasMixins, MixinDescriptor } from "./runtime/types";
export { readMixin } from "./runtime/read";
export { writeMixin } from "./runtime/write";
export { savedMixinVersion } from "./runtime/version";
export { validateMixin, type ValidationResult } from "./runtime/validate";
```

- [ ] **Step 9: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-mixins test runtime`
Expected: PASS.

- [ ] **Step 10: Typecheck + commit**

```bash
pnpm -F @viu/emporix-mixins typecheck
git add packages/mixins/src packages/mixins/tests
git commit -m "feat(repo): emporix-mixins runtime accessor (read/write/validate/version)"
```

---

## Task 3: Attribute → JSON Schema converter + source types

**Files:**
- Create: `packages/mixins/src/codegen/types.ts`, `src/codegen/attributes-to-jsonschema.ts`
- Test: `packages/mixins/tests/attributes-to-jsonschema.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mixins/tests/attributes-to-jsonschema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { attributesToJsonSchema } from "../src/codegen/attributes-to-jsonschema";

describe("attributesToJsonSchema", () => {
  it("maps Emporix attribute types to a JSON Schema object", () => {
    const schema = attributesToJsonSchema([
      { key: "packaging", type: "TEXT", required: true },
      { key: "count", type: "NUMBER" },
      { key: "active", type: "BOOLEAN" },
      { key: "tags", type: "ARRAY", arrayType: "TEXT" },
    ] as never);
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["packaging"],
      properties: {
        packaging: { type: "string" },
        count: { type: "number" },
        active: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
      },
    });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-mixins test attributes`
Expected: FAIL — module not found.

- [ ] **Step 3: `src/codegen/types.ts`**

```ts
import type { JsonSchema } from "../runtime/types";

/** A mixin normalized from any source. */
export interface RawMixin {
  key: string;
  entity: string;
  version: number;
  url: string;
  schema: JsonSchema;
}

/** A pluggable source of mixins (Schema Service, terraform output, files, …). */
export interface MixinSource {
  list(): Promise<RawMixin[]>;
}
```

- [ ] **Step 4: `src/codegen/attributes-to-jsonschema.ts`**

```ts
import type { JsonSchema } from "../runtime/types";

/** Minimal shape of an Emporix schema attribute (from the Schema Service). */
interface Attr {
  key: string;
  type: string;       // TEXT | NUMBER | BOOLEAN | OBJECT | ARRAY | ENUM | …
  required?: boolean;
  arrayType?: string; // element type when type === "ARRAY"
  values?: string[];  // enum values when type === "ENUM"
  attributes?: Attr[]; // nested when type === "OBJECT"
}

const SCALAR: Record<string, JsonSchema> = {
  TEXT: { type: "string" },
  STRING: { type: "string" },
  NUMBER: { type: "number" },
  DECIMAL: { type: "number" },
  INTEGER: { type: "integer" },
  BOOLEAN: { type: "boolean" },
};

function attrToSchema(a: Attr): JsonSchema {
  if (a.type === "OBJECT") return attributesToJsonSchema(a.attributes ?? []);
  if (a.type === "ARRAY") {
    const item = a.arrayType ? (SCALAR[a.arrayType] ?? { type: "string" }) : { type: "string" };
    return { type: "array", items: item };
  }
  if (a.type === "ENUM") return { type: "string", enum: a.values ?? [] };
  return SCALAR[a.type] ?? {};
}

/** Converts Emporix schema attributes into a JSON Schema object (fallback path). */
export function attributesToJsonSchema(attributes: Attr[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const a of attributes) {
    properties[a.key] = attrToSchema(a);
    if (a.required) required.push(a.key);
  }
  const out: JsonSchema = { type: "object", additionalProperties: false, properties };
  if (required.length) (out as { required?: string[] }).required = required;
  return out;
}
```

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-mixins test attributes`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mixins/src/codegen packages/mixins/tests/attributes-to-jsonschema.test.ts
git commit -m "feat(repo): emporix-mixins attribute→json-schema converter + source types"
```

---

## Task 4: Source adapters (schemaService, localFiles, cdnManifest)

**Files:**
- Create: `packages/mixins/src/codegen/adapters/schema-service.ts`, `src/codegen/adapters/local-files.ts`, `src/codegen/adapters/cdn-manifest.ts`
- Test: `packages/mixins/tests/schema-service.test.ts`

- [ ] **Step 1: Write the failing test (schemaService — the default + the nuanced one)**

`packages/mixins/tests/schema-service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { schemaService } from "../src/codegen/adapters/schema-service";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// minimal fake client: only the bits the adapter uses
function fakeClient(schemas: unknown[]) {
  return {
    schemas: {
      listSchemas: async () => ({ items: schemas, total: schemas.length }),
    },
  } as never;
}
const AUTH = { kind: "service" as const };

describe("schemaService adapter", () => {
  it("fetches the hosted JSON Schema per schema (one RawMixin per type)", async () => {
    server.use(
      http.get("https://cdn/deliveryOptions.v6.json", () =>
        HttpResponse.json({ type: "object", properties: { packaging: { type: "string" } } }),
      ),
    );
    const client = fakeClient([
      { id: "deliveryOptions", types: ["CUSTOMER", "ORDER"],
        metadata: { version: 6, url: "https://cdn/deliveryOptions.v6.json" }, attributes: [] },
    ]);
    const raw = await schemaService({ client, auth: AUTH }).list();
    expect(raw).toHaveLength(2); // one per type
    expect(raw[0]).toMatchObject({ key: "deliveryOptions", entity: "CUSTOMER", version: 6, url: "https://cdn/deliveryOptions.v6.json" });
    expect(raw[0].schema).toMatchObject({ type: "object" });
  });

  it("falls back to attribute conversion when the URL fetch fails", async () => {
    server.use(http.get("https://cdn/x.v1.json", () => new HttpResponse(null, { status: 404 })));
    const client = fakeClient([
      { id: "x", types: ["CART"], metadata: { version: 1, url: "https://cdn/x.v1.json" },
        attributes: [{ key: "note", type: "TEXT", required: true }] },
    ]);
    const raw = await schemaService({ client, auth: AUTH }).list();
    expect(raw[0].schema).toMatchObject({ type: "object", required: ["note"], properties: { note: { type: "string" } } });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-mixins test schema-service`
Expected: FAIL — module not found.

- [ ] **Step 3: `src/codegen/adapters/schema-service.ts`**

```ts
import type { JsonSchema } from "../../runtime/types";
import type { MixinSource, RawMixin } from "../types";
import { attributesToJsonSchema } from "../attributes-to-jsonschema";

interface SchemaLike {
  id?: string;
  types?: string[];
  metadata?: { version?: number; url?: string };
  attributes?: unknown[];
}
interface SchemaClientLike {
  schemas: { listSchemas: (q?: { type?: string; pageNumber?: number; pageSize?: number }) => Promise<{ items: SchemaLike[]; total: number }> };
}
interface AuthLike { kind: string }

/**
 * Default source: reads the tenant's Schema Service. Per schema, resolves the
 * JSON Schema by fetching `metadata.url` (authoritative); on fetch failure,
 * converts `attributes[]` as a fallback. Emits one RawMixin per entity type.
 */
export function schemaService(opts: {
  client: SchemaClientLike;
  auth?: AuthLike;
  types?: string[];
  fetchImpl?: typeof fetch;
}): MixinSource {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async list(): Promise<RawMixin[]> {
      // paginate
      const all: SchemaLike[] = [];
      let page = 1;
      for (;;) {
        const res = await opts.client.schemas.listSchemas({ pageNumber: page, pageSize: 100, ...(opts.types?.[0] ? { type: opts.types[0] } : {}) });
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
        page += 1;
      }
      const out: RawMixin[] = [];
      for (const s of all) {
        const key = s.id;
        const version = s.metadata?.version;
        const url = s.metadata?.url;
        if (!key || version === undefined || !url) continue;
        let schema: JsonSchema;
        try {
          const r = await doFetch(url);
          if (!r.ok) throw new Error(String(r.status));
          schema = (await r.json()) as JsonSchema;
        } catch {
          // eslint-disable-next-line no-console
          console.warn(`[emporix-mixins] schema "${key}": url fetch failed, falling back to attribute conversion`);
          schema = attributesToJsonSchema((s.attributes ?? []) as never);
        }
        for (const entity of s.types ?? ["UNKNOWN"]) {
          out.push({ key, entity, version, url, schema });
        }
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: `src/codegen/adapters/local-files.ts`**

```ts
import { readFile } from "node:fs/promises";
import type { MixinSource, RawMixin } from "../types";
import type { JsonSchema } from "../../runtime/types";

/** Reads pre-resolved mixins from local descriptor files: `[{ key, entity, version, url, schemaPath }]`. */
export function localFiles(opts: { manifest: Array<{ key: string; entity: string; version: number; url: string; schemaPath: string }> }): MixinSource {
  return {
    async list(): Promise<RawMixin[]> {
      return Promise.all(
        opts.manifest.map(async (m) => ({
          key: m.key, entity: m.entity, version: m.version, url: m.url,
          schema: JSON.parse(await readFile(m.schemaPath, "utf8")) as JsonSchema,
        })),
      );
    },
  };
}
```

- [ ] **Step 5: `src/codegen/adapters/cdn-manifest.ts`**

```ts
import type { MixinSource, RawMixin } from "../types";
import type { JsonSchema } from "../../runtime/types";

/** Fetches schemas from pinned CDN URLs. */
export function cdnManifest(opts: {
  entries: Array<{ key: string; entity: string; version: number; url: string }>;
  fetchImpl?: typeof fetch;
}): MixinSource {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async list(): Promise<RawMixin[]> {
      return Promise.all(
        opts.entries.map(async (e) => {
          const r = await doFetch(e.url);
          if (!r.ok) throw new Error(`[emporix-mixins] ${e.key}: ${e.url} → ${r.status}`);
          return { ...e, schema: (await r.json()) as JsonSchema };
        }),
      );
    },
  };
}
```

- [ ] **Step 6: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-mixins test schema-service`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add packages/mixins/src/codegen/adapters packages/mixins/tests/schema-service.test.ts
git commit -m "feat(repo): emporix-mixins source adapters (schemaService default + localFiles + cdnManifest)"
```

---

## Task 5: Snapshot, lock, generate

**Files:**
- Create: `packages/mixins/src/codegen/lock.ts`, `src/codegen/generate.ts`
- Modify: `packages/mixins/src/codegen.ts`
- Test: `packages/mixins/tests/generate.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mixins/tests/generate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildLock, diffLock } from "../src/codegen/lock";
import { generateTypes } from "../src/codegen/generate";
import type { RawMixin } from "../src/codegen/types";

const RAW: RawMixin[] = [
  { key: "deliveryOptions", entity: "CUSTOMER", version: 6, url: "https://cdn/d.v6.json",
    schema: { type: "object", additionalProperties: false, properties: { packaging: { type: "string" } } } },
];

describe("lock", () => {
  it("buildLock keys by mixin with version+url+hash; diffLock detects version change", () => {
    const a = buildLock(RAW);
    expect(a.deliveryOptions.version).toBe(6);
    const bumped = buildLock([{ ...RAW[0], version: 7, url: "https://cdn/d.v7.json" }]);
    const drift = diffLock(a, bumped);
    expect(drift).toEqual([{ key: "deliveryOptions", from: 6, to: 7 }]);
    expect(diffLock(a, a)).toEqual([]);
  });
});

describe("generate", () => {
  it("emits a versioned interface + a registry from raw mixins", async () => {
    const files = await generateTypes(RAW);
    const reg = files["registry.ts"];
    expect(files["delivery-options.ts"]).toMatch(/DeliveryOptionsMixinV6/);
    expect(reg).toMatch(/export const mixins/);
    expect(reg).toMatch(/deliveryOptions:/);
    expect(reg).toMatch(/MixinDescriptor<DeliveryOptionsMixinV6>/);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-mixins test generate`
Expected: FAIL — modules not found.

- [ ] **Step 3: `src/codegen/lock.ts`**

```ts
import { createHash } from "node:crypto";
import type { RawMixin } from "./types";

export interface LockEntry { version: number; url: string; entity: string; hash: string }
export type Lock = Record<string, LockEntry>;

/** A lockfile keyed by mixin key. `hash` covers the schema content so content-only changes also surface. */
export function buildLock(raw: RawMixin[]): Lock {
  const lock: Lock = {};
  for (const m of raw) {
    lock[m.key] = {
      version: m.version,
      url: m.url,
      entity: m.entity,
      hash: createHash("sha256").update(JSON.stringify(m.schema)).digest("hex").slice(0, 16),
    };
  }
  return lock;
}

/** Returns the keys whose version/url/hash differ between two locks. */
export function diffLock(a: Lock, b: Lock): Array<{ key: string; from?: number; to?: number }> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Array<{ key: string; from?: number; to?: number }> = [];
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (!x || !y || x.version !== y.version || x.url !== y.url || x.hash !== y.hash) {
      out.push({ key, ...(x ? { from: x.version } : {}), ...(y ? { to: y.version } : {}) });
    }
  }
  return out;
}
```

- [ ] **Step 4: `src/codegen/generate.ts`**

```ts
import type { RawMixin } from "./types";

const pascal = (s: string) => s.replace(/(^|[-_ ])(\w)/g, (_m, _p, c: string) => c.toUpperCase());
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_ ]+/g, "-").toLowerCase();
const typeName = (m: RawMixin) => `${pascal(m.key)}MixinV${m.version}`;

const BANNER = "// AUTO-GENERATED by @viu/emporix-mixins — do not edit.\n";

/** Generates `{ "<kebab>.ts": <interface>, "registry.ts": <registry> }` from raw mixins. */
export async function generateTypes(raw: RawMixin[]): Promise<Record<string, string>> {
  const { compile } = await import("json-schema-to-typescript");
  const files: Record<string, string> = {};
  const imports: string[] = [];
  const entries: string[] = [];
  for (const m of raw) {
    const name = typeName(m);
    const ts = await compile(m.schema as never, name, { bannerComment: "", additionalProperties: false });
    const file = `${kebab(m.key)}.ts`;
    files[file] = BANNER + ts;
    imports.push(`import type { ${name} } from "./${kebab(m.key)}";`);
    entries.push(
      `  ${m.key}: { key: ${JSON.stringify(m.key)}, entity: ${JSON.stringify(m.entity)}, ` +
        `version: ${m.version}, url: ${JSON.stringify(m.url)}, schema: ${JSON.stringify(m.schema)} } as MixinDescriptor<${name}>,`,
    );
  }
  files["registry.ts"] =
    BANNER +
    `import type { MixinDescriptor } from "@viu/emporix-mixins";\n` +
    imports.join("\n") +
    `\n\nexport const mixins = {\n${entries.join("\n")}\n} as const;\n`;
  return files;
}
```

- [ ] **Step 5: `src/codegen.ts` — export the build-time API + adapters**

```ts
export type { RawMixin, MixinSource } from "./codegen/types";
export { schemaService } from "./codegen/adapters/schema-service";
export { localFiles } from "./codegen/adapters/local-files";
export { cdnManifest } from "./codegen/adapters/cdn-manifest";
export { attributesToJsonSchema } from "./codegen/attributes-to-jsonschema";
export { buildLock, diffLock, type Lock, type LockEntry } from "./codegen/lock";
export { generateTypes } from "./codegen/generate";
```

- [ ] **Step 6: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-mixins test generate`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/mixins/src/codegen.ts packages/mixins/src/codegen/lock.ts packages/mixins/src/codegen/generate.ts packages/mixins/tests/generate.test.ts
git commit -m "feat(repo): emporix-mixins snapshot/lock + json-schema→ts generate"
```

---

## Task 6: CLI (`pull` / `generate` / `check`)

**Files:**
- Create: `packages/mixins/src/codegen/run.ts` (orchestration, testable), `src/cli.ts` (thin bin)
- Test: `packages/mixins/tests/run.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mixins/tests/run.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runCheck } from "../src/codegen/run";
import type { MixinSource } from "../src/codegen/types";
import { buildLock } from "../src/codegen/lock";

const source: MixinSource = {
  list: async () => [
    { key: "x", entity: "CART", version: 7, url: "https://cdn/x.v7.json", schema: { type: "object" } },
  ],
};

describe("runCheck", () => {
  it("reports drift when the live version differs from the lock", async () => {
    const lock = buildLock([{ key: "x", entity: "CART", version: 6, url: "https://cdn/x.v6.json", schema: { type: "object" } }]);
    const res = await runCheck(source, lock);
    expect(res.drift).toEqual([{ key: "x", from: 6, to: 7 }]);
  });

  it("reports no drift when in sync", async () => {
    const lock = buildLock(await source.list());
    const res = await runCheck(source, lock);
    expect(res.drift).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-mixins test run`
Expected: FAIL — module not found.

- [ ] **Step 3: `src/codegen/run.ts`**

```ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MixinSource } from "./types";
import { buildLock, diffLock, type Lock } from "./lock";
import { generateTypes } from "./generate";

export interface MixinsConfig {
  source: MixinSource;
  out: string;
  lockfile: string;
}

/** `check`: compare the live source against a lock; returns the drift list (empty = in sync). */
export async function runCheck(source: MixinSource, lock: Lock): Promise<{ drift: Array<{ key: string; from?: number; to?: number }> }> {
  const live = buildLock(await source.list());
  return { drift: diffLock(lock, live) };
}

/** `pull`: write snapshot.json next to the lockfile + (re)write the lockfile. */
export async function runPull(cfg: MixinsConfig): Promise<void> {
  const raw = await cfg.source.list();
  const snapshot = join(dirname(cfg.lockfile), "snapshot.json");
  await mkdir(dirname(cfg.lockfile), { recursive: true });
  await writeFile(snapshot, JSON.stringify(raw, null, 2));
  await writeFile(cfg.lockfile, JSON.stringify(buildLock(raw), null, 2));
}

/** `generate`: read snapshot.json → emit the typed files into `out`. */
export async function runGenerate(cfg: MixinsConfig): Promise<void> {
  const snapshot = join(dirname(cfg.lockfile), "snapshot.json");
  const raw = JSON.parse(await readFile(snapshot, "utf8"));
  const files = await generateTypes(raw);
  await mkdir(cfg.out, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(cfg.out, name), content);
  }
}
```

- [ ] **Step 4: `src/cli.ts` — thin bin that loads the config via jiti and dispatches**

```ts
#!/usr/bin/env node
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";
import { runCheck, runPull, runGenerate, type MixinsConfig } from "./codegen/run";
import { buildLock } from "./codegen/lock";

async function loadConfig(): Promise<MixinsConfig> {
  const path = resolve(process.cwd(), "emporix-mixins.config.ts");
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(path)) as { default: MixinsConfig };
  return mod.default;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const cfg = await loadConfig();
  if (cmd === "pull") {
    await runPull(cfg);
    console.log("[emporix-mixins] pull: snapshot + lock written");
  } else if (cmd === "generate") {
    await runGenerate(cfg);
    console.log(`[emporix-mixins] generate: types written to ${cfg.out}`);
  } else if (cmd === "check") {
    const lock = JSON.parse(await readFile(cfg.lockfile, "utf8"));
    const { drift } = await runCheck(cfg.source, lock);
    if (drift.length === 0) {
      console.log("[emporix-mixins] check: in sync");
    } else {
      console.error("[emporix-mixins] check: DRIFT", JSON.stringify(drift));
      process.exitCode = 1;
    }
    void buildLock; // (referenced for type alignment)
  } else {
    console.error("usage: emporix-mixins <pull|generate|check>");
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-mixins test run`
Expected: PASS.

- [ ] **Step 6: Build + typecheck (CLI is part of the bundle) + commit**

```bash
pnpm -F @viu/emporix-mixins build
pnpm -F @viu/emporix-mixins typecheck
git add packages/mixins/src/codegen/run.ts packages/mixins/src/cli.ts packages/mixins/tests/run.test.ts
git commit -m "feat(repo): emporix-mixins CLI (pull/generate/check) + run orchestration"
```

---

## Task 7: README, changeset, full verify, finish

**Files:**
- Create: `packages/mixins/README.md`, `.changeset/emporix-mixins.md`

- [ ] **Step 1: README** — write `packages/mixins/README.md` covering: what it is (generic, no tenant data), runtime quickstart (`readMixin`/`writeMixin`/`validateMixin`), CLI quickstart (`emporix-mixins.config.ts` + `pull`/`generate`/`check`), "write your own adapter" (implement `MixinSource`), and a copy-paste drift-workflow template:

````markdown
# @viu/emporix-mixins

Generic, tenant-agnostic toolkit to resolve Emporix mixins as typed values and
keep the types in sync with the Schema Service. Ships **no tenant data** — you
configure a source and generate types into your own repo.

## Runtime

```ts
import { readMixin, writeMixin, validateMixin } from "@viu/emporix-mixins";
import { mixins } from "./mixins/generated/registry";

const opts = readMixin(customer, mixins.deliveryOptions);                 // typed | undefined
const body = writeMixin({}, mixins.deliveryOptions, { packaging: "Paper" }); // sets mixins + metadata.mixins
const res  = await validateMixin(opts, mixins.deliveryOptions);          // { valid, errors? } (needs optional peer `ajv`)
```

## Codegen (CLI)

`emporix-mixins.config.ts`:
```ts
import { schemaService } from "@viu/emporix-mixins/codegen";
import { client } from "./src/emporix";
import { auth } from "@viu/emporix-sdk";
export default { source: schemaService({ client, auth: auth.service() }), out: "src/mixins/generated", lockfile: "src/mixins/mixins.lock.json" };
```
```bash
npx emporix-mixins pull && npx emporix-mixins generate   # commit the output
npx emporix-mixins check                                  # CI drift gate
```

## Custom source

```ts
import type { MixinSource } from "@viu/emporix-mixins/codegen";
const mySource: MixinSource = { async list() { /* → RawMixin[] */ return []; } };
```

## Drift workflow (copy into your repo)

```yaml
# .github/workflows/mixin-drift.yml
on: { schedule: [{ cron: "0 6 * * *" }], workflow_dispatch: {} }
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm i
      - run: npx emporix-mixins pull && npx emporix-mixins generate
      - uses: peter-evans/create-pull-request@v6
        with: { title: "chore(mixins): sync schema versions", branch: "mixins/sync" }
```
````

- [ ] **Step 2: Changeset**

`.changeset/emporix-mixins.md`:
```md
---
"@viu/emporix-mixins": minor
---

feat: initial release — generic mixin resolution + Schema-Service sync

Runtime accessor (`readMixin` / `writeMixin` / `validateMixin` / `savedMixinVersion`),
pluggable `MixinSource` adapters (`schemaService` default, `localFiles`,
`cdnManifest`), and an `emporix-mixins` CLI (`pull` / `generate` / `check`) that
generates versioned mixin types + a registry into the consumer repo and detects
version drift.
```

- [ ] **Step 3: Full verify**

```bash
pnpm -r --filter "./packages/*" build
pnpm -r typecheck
pnpm -r test
```
Expected: all pass (the new package builds, typechecks, and its Vitest suite is green).

- [ ] **Step 4: Commit**

```bash
git add packages/mixins/README.md .changeset/emporix-mixins.md
git commit -m "docs(repo): emporix-mixins README + changeset"
```

- [ ] **Step 5: Finish**

**REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch`. Branch `feat/emporix-mixins` (off `main`).

---

## Self-Review

- **Spec coverage:** runtime accessor incl. `metadata.mixins`-write + version-warning (T2); `MixinSource` + `RawMixin` + attribute→JSON-Schema (T3); `schemaService` (default, url-fetch + attribute fallback) + `localFiles` + `cdnManifest` (T4); snapshot/lock/`generate` versioned types + registry (T5); CLI `pull`/`generate`/`check` via jiti `.ts` config (T6); package + publishing (subpath exports, optional ajv peer, bin) (T1); README + changeset + verify + finish (T7). `terraformOutput` is explicitly deferred (header note). All spec sections covered.
- **Placeholder scan:** every step ships complete code/commands.
- **Type consistency:** `MixinDescriptor`/`HasMixins`/`JsonSchema` (T2) reused by `RawMixin`/`MixinSource` (T3), the adapters (T4), `generate`/`lock` (T5), `run`/`cli` (T6). `schemaService` reads `id`/`metadata.version`/`metadata.url`/`types`/`attributes` (verified against `SchemaResponse`). `generateTypes` emits `<Pascal>MixinV<version>` consistently with the registry's `MixinDescriptor<…>` cast.
- **Refinement flagged:** `validateMixin` async + `readMixin` sync-without-validate (browser-safe ajv lazy-load) — noted in the header, satisfies the validation requirement.
