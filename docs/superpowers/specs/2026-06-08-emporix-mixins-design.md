# `@viu/emporix-mixins` — Design Spec

**Date:** 2026-06-08
**Status:** Approved (brainstorming) → ready for implementation plan
**New package:** `@viu/emporix-mixins` (`packages/mixins/`), published to npm

## Overview

A generic, tenant-agnostic toolkit for resolving Emporix **mixins** (custom JSON-Schema-described properties under `entity.mixins.*`) into typed values, and for keeping those types in sync with the Schema Service across versions. The package contains **no tenant data, no schemas, no URLs** — everything tenant-specific is either an **input** (a configured `MixinSource`) or an **output** (generated files written into the *consumer's* repo). Published alongside `@viu/emporix-sdk` so any storefront/tenant can consume and extend it.

## Background (verified)

- A mixin = custom properties on an entity under `mixins.{key}`, described by a **JSON Schema** (draft-04) hosted on a CDN (e.g. `…/deliveryOptionsMixIn.v6.json`). The entity references the schema URL in `metadata.mixins.{key}`; the **version is in the URL/filename** (`.v6`).
- The **Schema Service** (`/schema/{tenant}/…`, already wrapped by `client.schemas`) returns each schema as `{ name, types: SchemaTypeName[], attributes: SchemaAttribute[], metadata: { version, url } }` — Emporix's attribute model, **not** raw JSON Schema, plus a server-assigned `version` and a hosted `url`.
- Today the SDK types `mixins` as `{ [key:string]: unknown }` everywhere (untyped). Emporix assigns a **new version on every Terraform change**, so the consumer repo can only **observe** versions, not predict them.
- Mixin types are **tenant-specific** → they belong in the consumer repo, not in this generic published package.

## Goal

`readMixin(entity, descriptor)` / `writeMixin(body, descriptor, value)` (typed runtime access) + an `emporix-mixins` CLI (`pull` / `generate` / `check`) that reads a configured `MixinSource` (default: the Schema Service), generates versioned TS types + a registry into the consumer repo, and detects version drift for an automated PR.

## Architecture — three units

### Unit 1 — Runtime accessor (light, structural, tenant-agnostic)

Works on any Emporix entity via its structural shape; no tenant knowledge.

```ts
interface HasMixins {
  mixins?: Record<string, unknown>;
  metadata?: { mixins?: Record<string, string> };
}

interface MixinDescriptor<T = unknown> {
  key: string;          // "deliveryOptions" — the key under entity.mixins
  entity: string;       // "CUSTOMER" (informational)
  url: string;          // ".../deliveryOptionsMixIn.v6.json" — written into metadata.mixins
  version: number;      // 6
  schema?: JsonSchema;  // optional → lazy ajv validation
  readonly __type?: T;  // phantom: carries the generated TS shape
}

function readMixin<T>(e: HasMixins, d: MixinDescriptor<T>, o?: { validate?: boolean }): T | undefined;
function writeMixin<T, B extends object>(body: B, d: MixinDescriptor<T>, value: T): B & HasMixins;
function validateMixin<T>(value: unknown, d: MixinDescriptor<T>): { valid: boolean; errors?: string[] };
function savedMixinVersion(e: HasMixins, key: string): number | undefined; // parse version from metadata.mixins[key]
```

- `writeMixin` sets `mixins[key] = value` **and** `metadata.mixins[key] = d.url` (the part consumers get wrong).
- `readMixin` returns `mixins[key]` typed as `T`; with `{ validate: true }` it lazy-loads `ajv` and validates against `d.schema`; it also compares `savedMixinVersion(e, d.key)` to `d.version` and emits a `console.warn` on mismatch (drift signal). With no callback/data it never throws.
- **`ajv` is an optional peer, loaded lazily** — the default read path pulls zero validation deps.

### Unit 2 — Source adapters (the only tenant boundary, pluggable)

```ts
interface RawMixin { key: string; entity: string; version: number; url: string; schema: JsonSchema; }
interface MixinSource { list(): Promise<RawMixin[]>; }
```

Built-in adapters (consumer picks one in config, or implements their own):

- **`schemaService({ client, auth?, types? })` — DEFAULT.** Paginates `client.schemas.listSchemas({ type? })` → for each schema derives `{ key, entity (one RawMixin per `types[]` entry), version = metadata.version, url = metadata.url }`. **Schema resolution: `fetch(metadata.url)` (the hosted `…vN.json`, authoritative); on fetch failure, convert `attributes[] → JSON Schema` as a fallback.** Requires `@viu/emporix-sdk` (optional peer).
- `terraformOutput({ dir, outputName })` — runs `terraform output -json <name>` → normalizes to `RawMixin[]`.
- `cdnManifest({ entries })` — fetches a list of pinned `{ key, entity, url, version }` and the schema bodies.
- `localFiles({ glob })` — reads local `*.json` schemas.

The package imports nothing tenant-specific; binding happens only through the configured adapter.

### Unit 3 — Codegen CLI (`emporix-mixins`, config-driven)

Config file `emporix-mixins.config.ts` in the consumer repo (**TypeScript**, loaded via `jiti`):

```ts
import { schemaService } from "@viu/emporix-mixins/codegen";
import { client } from "./src/emporix";
import { auth } from "@viu/emporix-sdk";
export default {
  source: schemaService({ client, auth: auth.service() }),
  out: "src/mixins/generated",
  lockfile: "src/mixins/mixins.lock.json",
};
```

Commands:

- **`pull`** — `source.list()` → write `<out>/../snapshot.json` and update `mixins.lock.json` (`key → { version, url, entity, hash }`).
- **`generate`** — `snapshot.json[].schema` → `json-schema-to-typescript` → `<out>/<key>.ts` (versioned interfaces, e.g. `DeliveryOptionsMixinV6`) + `<out>/registry.ts` (`export const mixins = { deliveryOptions: {…} as MixinDescriptor<DeliveryOptionsMixinV6>, … }`). Output carries an `// AUTO-GENERATED` banner.
- **`check`** — `source.list()` vs `mixins.lock.json`: exits non-zero and prints a summary on any version/url/hash difference (CI-friendly → drives the drift PR).

## Data flow / sync

```
Terraform (SOT) → apply → Emporix Schema Service assigns version vN (+ hosted url)
   consumer CI (scheduled): emporix-mixins check  →  drift?  →  pull + generate  →  Auto-PR (lock bump + type diff)
   runtime: readMixin compares metadata.mixins[key] version vs descriptor → warn on mismatch (covers the gap until merge)
```

## Package layout & publishing

```
packages/mixins/                       @viu/emporix-mixins
├── src/
│   ├── index.ts          runtime: readMixin/writeMixin/validateMixin/savedMixinVersion + types
│   ├── codegen.ts        pull/generate/check + adapters (schemaService/terraformOutput/cdnManifest/localFiles)
│   ├── runtime/*         read.ts, write.ts, validate.ts (lazy ajv), version.ts, types.ts
│   ├── codegen/*         source adapters, generate.ts, lock.ts, snapshot.ts, attributes-to-jsonschema.ts
│   └── cli.ts            bin entry → loads config via jiti, dispatches pull/generate/check
└── package.json
```

`package.json` essentials:

```jsonc
{
  "name": "@viu/emporix-mixins",
  "exports": {
    ".":         { "types": "./dist/index.d.ts",   "import": "./dist/index.js",   "require": "./dist/index.cjs" },
    "./codegen": { "types": "./dist/codegen.d.ts", "import": "./dist/codegen.js", "require": "./dist/codegen.cjs" }
  },
  "bin": { "emporix-mixins": "./dist/cli.js" },
  "files": ["dist"],
  "sideEffects": false,
  "dependencies": { "jiti": "^2" },
  "optionalDependencies": { "json-schema-to-typescript": "^15" },
  "peerDependencies": { "@viu/emporix-sdk": "workspace:^", "ajv": "^8" },
  "peerDependenciesMeta": { "@viu/emporix-sdk": { "optional": true }, "ajv": { "optional": true } },
  "publishConfig": { "access": "public" }
}
```

Build via `tsup` (ESM + CJS + d.ts, three entries: `index`, `codegen`, `cli`). Versioned + published by the existing Changesets `release.yml` (NOT added to `.changeset/config.json` `ignore`).

## Error handling

- `MixinSource.list()` throws on source errors (no silent partial sync); `schemaService` falls back to attribute-conversion only on a per-schema fetch failure, and logs which schema fell back.
- `readMixin` → `undefined` when the mixin is absent; never throws on missing data.
- `validateMixin` → `{ valid, errors }` (never throws); `readMixin({ validate: true })` throws only if `ajv` is requested but not installed (clear message).
- `check` exits non-zero on drift (CI gate / PR trigger).

## Testing (Vitest, no live tenant)

- **Runtime:** `readMixin`/`writeMixin` set/read `mixins` + `metadata.mixins`; `writeMixin` sets the url; `savedMixinVersion` parses `.vN`; `validateMixin` valid/invalid; version-mismatch warning fires.
- **Adapters:** `schemaService` (MSW): paginated `listSchemas`, url-fetch happy path, fetch-failure → attribute-conversion fallback, one-RawMixin-per-type. `localFiles`/`cdnManifest` basic.
- **Codegen:** `generate` produces a stable type + registry from a fixture schema (snapshot test); `check` reports drift when lock ≠ source.
- **`attributes-to-jsonschema`:** the Emporix attribute → JSON Schema mapping for each attribute type.

## Out of scope (YAGNI)

- Tenant-specific generated types / lockfile / drift workflow (these live in the **consumer** repo; the package ships a workflow *template* in its README).
- Schema *creation*/registration (Terraform + Schema Service own that).
- UI; streaming; non-JSON mixin payloads.

## File structure summary

| File | Responsibility |
| --- | --- |
| `packages/mixins/src/runtime/*` | accessor + types (`HasMixins`, `MixinDescriptor`) |
| `packages/mixins/src/codegen/*` | `MixinSource` + adapters + generate/lock/snapshot + attribute→JSON-Schema |
| `packages/mixins/src/cli.ts` | `emporix-mixins` bin (jiti config loader) |
| `packages/mixins/src/{index,codegen}.ts` | the two public entrypoints |
| `packages/mixins/tests/*` | Vitest (MSW for `schemaService`) |
| `packages/mixins/README.md` | runtime + CLI quickstart, "write your own adapter", drift-workflow template |
| `.changeset/*` | release entry (`@viu/emporix-mixins` initial minor) |

Commitlint: `mixins` is not an allowed scope → commits use `sdk` / `repo`.
