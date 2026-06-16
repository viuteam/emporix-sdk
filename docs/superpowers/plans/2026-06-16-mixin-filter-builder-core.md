# Mixin Filter Builder (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a type-safe, entity-generic mixin filter builder to `@viu/emporix-mixins` and wire it into Product search across the SDK and React, so callers build Emporix `q` filters from typed `MixinDescriptor`s instead of raw strings.

**Architecture:** The builder lives in `@viu/emporix-mixins` (runtime entry, browser-safe, no SDK dependency) and only produces a `q` string. `MixinDescriptor<T, E>` carries the entity literal, propagated onto `MixinFilter<E>` via a phantom `__entity` field. The SDK gains a tiny structural `resolveQuery()` normalizer (no cross-package import) that each service routes its `q` through and that enforces the `compoundLogicalQuery` (OR) capability gate. Product search is the first consumer; the remaining services are a separate follow-up plan.

**Tech Stack:** TypeScript, Vitest + MSW (unit tests), tsup (build), pnpm workspaces, `@tanstack/react-query` (React hooks).

**Scope note:** This is Plan 1 of 2 from `docs/superpowers/specs/2026-06-16-mixin-filter-builder-design.md`. It delivers the builder + Product wiring (independently shippable). Plan 2 wires the remaining q-capable services (Customer, Category, Cart, Order/SalesOrder, Price, Availability) + passthrough services + their hooks. **Localized mixin fields ARE supported** via a `{ lang, ... }` operator (Task 3). **Out of Plan 1 scope:** attribute-level `exists`/`missing` semantics confirmation (Q2) and date-range values — documented as deferred.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/mixins/src/runtime/types.ts` | `MixinDescriptor` type — add entity param `E` | Modify |
| `packages/mixins/src/codegen/generate.ts` | Emit the entity literal into generated descriptors | Modify |
| `packages/mixins/src/runtime/query.ts` | The filter builder: `mixinQuery`/`and`/`or`/`raw`, `MixinFilter`, `MixinWhere` | Create |
| `packages/mixins/src/index.ts` | Export the new builder symbols | Modify |
| `packages/mixins/tests/query.test.ts` | Builder unit tests (exact `q` strings) | Create |
| `packages/mixins/tests/query-types.test.ts` | Type-level gating tests (`@ts-expect-error`) | Create |
| `packages/mixins/tests/generate-entity.test.ts` | Codegen entity-literal test | Create |
| `packages/sdk/src/core/query.ts` | `resolveQuery` + `QueryFor`/`BuiltQuery`/`QueryCapability` | Create |
| `packages/sdk/src/index.ts` | Export `resolveQuery` + query types | Modify |
| `packages/sdk/tests/core/query.test.ts` | `resolveQuery` unit tests | Create |
| `packages/sdk/src/services/product.ts` | `search()` accepts `QueryFor<"PRODUCT">` | Modify |
| `packages/sdk/tests/services/product.test.ts` | Test search-with-filter | Modify |
| `packages/react/src/hooks/use-products.ts` | `useProductSearch` accepts `QueryFor<"PRODUCT">` | Modify |
| `packages/react/tests/use-products.test.tsx` | Test hook-with-filter | Modify |
| `docs/mixin-search.md` | Usage docs + capability matrix | Create |
| `.changeset/mixin-filter-builder.md` | Release note | Create |

---

## Task 1: Add entity type parameter to `MixinDescriptor`

**Files:**
- Modify: `packages/mixins/src/runtime/types.ts`
- Test (typecheck-driven): `packages/mixins/tests/query-types.test.ts` (created in Task 4; this task is verified by typecheck)

- [ ] **Step 1: Write the failing typecheck assertion**

Append to `packages/mixins/src/runtime/types.ts` a temporary check at the bottom (remove in Step 3 — it only proves the failure):

```ts
// TEMP: proves the 2-arg form does not compile yet.
type _Check = MixinDescriptor<{ a?: string }, "PRODUCT">;
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm -F @viu/emporix-mixins typecheck`
Expected: FAIL with `Type 'MixinDescriptor' is generic but type argument ... Expected 1 type arguments, but got 2.`

- [ ] **Step 3: Add the entity parameter**

In `packages/mixins/src/runtime/types.ts`, replace the `MixinDescriptor` interface and delete the TEMP check:

```ts
/** Identifies one mixin and how to resolve it. Generated per tenant, consumed by the runtime. */
export interface MixinDescriptor<T = unknown, E extends string = string> {
  key: string;
  entity: E;
  url: string;
  version: number;
  schema?: JsonSchema;
  readonly __type?: T;
}
```

- [ ] **Step 4: Run typecheck + existing tests to verify back-compat**

Run: `pnpm -F @viu/emporix-mixins typecheck`
Expected: PASS (the temp check is gone; `E` defaults to `string`, so existing `MixinDescriptor<{...}>` usages still compile).

Run: `pnpm -F @viu/emporix-mixins exec vitest run tests/runtime.test.ts`
Expected: PASS (existing runtime tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/mixins/src/runtime/types.ts
git commit -m "feat(mixins): add entity type parameter to MixinDescriptor"
```

---

## Task 2: Codegen emits the entity literal

**Files:**
- Modify: `packages/mixins/src/codegen/generate.ts:34-37` (the `entries.push(...)` block)
- Test: `packages/mixins/tests/generate-entity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mixins/tests/generate-entity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateTypes } from "../src/codegen/generate";
import type { RawMixin } from "../src/codegen/types";

const raw: RawMixin[] = [
  {
    key: "productCustomAttributes",
    entity: "PRODUCT",
    version: 3,
    url: "https://cdn/productCustomAttributes.v3.json",
    schema: {
      type: "object",
      properties: { color: { type: "string" } },
      additionalProperties: false,
    },
  },
];

describe("generateTypes — entity literal", () => {
  it("casts each registry entry to MixinDescriptor<Name, \"ENTITY\">", async () => {
    const files = await generateTypes(raw);
    const registry = files["registry.ts"];
    // The interface name may be renormalized by json-schema-to-typescript;
    // assert only the entity literal landed in the cast.
    expect(registry).toMatch(/as MixinDescriptor<\w+, "PRODUCT">/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-mixins exec vitest run tests/generate-entity.test.ts`
Expected: FAIL — the current cast is `as MixinDescriptor<ProductCustomAttributesMixinV3>` (no entity literal), so the regex does not match.

- [ ] **Step 3: Add the entity literal to the generated cast**

In `packages/mixins/src/codegen/generate.ts`, change the `entries.push(...)` call so the cast includes the entity literal:

```ts
    entries.push(
      `  ${JSON.stringify(m.key)}: { key: ${JSON.stringify(m.key)}, entity: ${JSON.stringify(m.entity)}, ` +
        `version: ${m.version}, url: ${JSON.stringify(m.url)}, schema: ${JSON.stringify(m.schema)} } ` +
        `as MixinDescriptor<${name}, ${JSON.stringify(m.entity)}>,`,
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-mixins exec vitest run tests/generate-entity.test.ts`
Expected: PASS

Run: `pnpm -F @viu/emporix-mixins exec vitest run tests/generate.test.ts`
Expected: PASS (existing codegen tests still pass — the entry shape is unchanged except the type cast).

- [ ] **Step 5: Commit**

```bash
git add packages/mixins/src/codegen/generate.ts packages/mixins/tests/generate-entity.test.ts
git commit -m "feat(mixins): emit entity literal in generated descriptor registry"
```

---

## Task 3: The filter builder (`mixinQuery`/`and`/`or`/`raw`)

**Files:**
- Create: `packages/mixins/src/runtime/query.ts`
- Modify: `packages/mixins/src/index.ts`
- Test: `packages/mixins/tests/query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mixins/tests/query.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mixinQuery, and, or, raw } from "../src/index";
import type { MixinDescriptor } from "../src/index";

const COLOR: MixinDescriptor<
  { color?: string; qty?: number; inStock?: boolean; title?: string },
  "PRODUCT"
> = {
  key: "attrs",
  entity: "PRODUCT",
  url: "https://cdn/attrs.v1.json",
  version: 1,
};

describe("mixinQuery — operators", () => {
  it("renders a bare value as equals", () => {
    expect(mixinQuery(COLOR, { color: "Blue" }).toString()).toBe("mixins.attrs.color:Blue");
  });

  it("renders explicit { eq }", () => {
    expect(mixinQuery(COLOR, { color: { eq: "Blue" } }).toString()).toBe("mixins.attrs.color:Blue");
  });

  it("renders a single comparison without parentheses", () => {
    expect(mixinQuery(COLOR, { qty: { gt: 20 } }).toString()).toBe("mixins.attrs.qty:>20");
  });

  it("renders a numeric range with parentheses", () => {
    expect(mixinQuery(COLOR, { qty: { gte: 10, lte: 20 } }).toString()).toBe(
      "mixins.attrs.qty:(>=10 AND <=20)",
    );
  });

  it("renders an in-list", () => {
    expect(mixinQuery(COLOR, { color: { in: ["Blue", "Black"] } }).toString()).toBe(
      "mixins.attrs.color:(Blue,Black)",
    );
  });

  it("renders a regex with ~", () => {
    expect(mixinQuery(COLOR, { color: { regex: "Bl" } }).toString()).toBe("mixins.attrs.color:~Bl");
  });

  it("renders booleans", () => {
    expect(mixinQuery(COLOR, { inStock: true }).toString()).toBe("mixins.attrs.inStock:true");
  });

  it("renders exists / missing", () => {
    expect(mixinQuery(COLOR, { color: { exists: true } }).toString()).toBe("mixins.attrs.color:exists");
    expect(mixinQuery(COLOR, { color: { exists: false } }).toString()).toBe("mixins.attrs.color:missing");
  });

  it("space-joins multiple clauses (implicit AND)", () => {
    expect(mixinQuery(COLOR, { color: "Blue", inStock: true }).toString()).toBe(
      "mixins.attrs.color:Blue mixins.attrs.inStock:true",
    );
  });

  it("supports a path prefix for embedded mixins", () => {
    expect(mixinQuery(COLOR, { color: "Blue" }, { prefix: "customer" }).toString()).toBe(
      "customer.mixins.attrs.color:Blue",
    );
  });

  it("renders a localized attribute with the language segment", () => {
    expect(mixinQuery(COLOR, { title: { lang: "en", eq: "Sale" } }).toString()).toBe(
      "mixins.attrs.title.en:Sale",
    );
  });

  it("renders a localized regex match", () => {
    expect(mixinQuery(COLOR, { title: { lang: "de", regex: "ange" } }).toString()).toBe(
      "mixins.attrs.title.de:~ange",
    );
  });

  it("throws on whitespace in a value (unverified escaping)", () => {
    expect(() => mixinQuery(COLOR, { color: "1000 GB" }).toString()).toThrow(/whitespace/i);
  });

  it("throws on an empty where", () => {
    expect(() => mixinQuery(COLOR, {})).toThrow(/empty where/i);
  });
});

describe("combinators", () => {
  it("and() space-joins non-compound filters", () => {
    const q = and(mixinQuery(COLOR, { color: "Blue" }), mixinQuery(COLOR, { inStock: true }));
    expect(q.toString()).toBe("mixins.attrs.color:Blue mixins.attrs.inStock:true");
    expect(q.usesCompound).toBe(false);
  });

  it("or() emits compoundLogicalQuery and flags usesCompound", () => {
    const q = or(mixinQuery(COLOR, { color: "Blue" }), mixinQuery(COLOR, { color: "Black" }));
    expect(q.toString()).toBe(
      "compoundLogicalQuery:((mixins.attrs.color:Blue) OR (mixins.attrs.color:Black))",
    );
    expect(q.usesCompound).toBe(true);
  });

  it("and() with a compound child becomes a compoundLogicalQuery AND", () => {
    const q = and(
      mixinQuery(COLOR, { inStock: true }),
      or(mixinQuery(COLOR, { color: "Blue" }), mixinQuery(COLOR, { color: "Black" })),
    );
    expect(q.toString()).toBe(
      "compoundLogicalQuery:((mixins.attrs.inStock:true) AND " +
        "(compoundLogicalQuery:((mixins.attrs.color:Blue) OR (mixins.attrs.color:Black))))",
    );
    expect(q.usesCompound).toBe(true);
  });

  it("raw() is an entity-agnostic passthrough that composes with and()", () => {
    const q = and(mixinQuery(COLOR, { color: "Blue" }), raw("published:true"));
    expect(q.toString()).toBe("mixins.attrs.color:Blue published:true");
  });

  it("build() equals toString()", () => {
    const q = mixinQuery(COLOR, { color: "Blue" });
    expect(q.build()).toBe(q.toString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-mixins exec vitest run tests/query.test.ts`
Expected: FAIL — `mixinQuery`/`and`/`or`/`raw` are not exported (module resolution / undefined).

- [ ] **Step 3: Write the builder**

Create `packages/mixins/src/runtime/query.ts`:

```ts
import type { MixinDescriptor } from "./types";

/** A built `q` filter. Produced by {@link mixinQuery}/{@link and}/{@link or}/{@link raw}. */
export interface MixinFilter<E extends string = string> {
  /** The `q` fragment, parenthesized when compound. */
  toString(): string;
  /** Alias of {@link toString}. */
  build(): string;
  /** True when the fragment contains a `compoundLogicalQuery` (from `or()`). */
  readonly usesCompound: boolean;
  /** Phantom field carrying the entity for structural gating in the SDK. */
  readonly __entity?: E;
}

/** Operator objects for an attribute of value type `V`, gated by `V`. */
export type MixinOps<V> =
  | { eq: V }
  | { exists: boolean }
  | (V extends string ? { in: readonly string[] } | { regex: string } : never)
  | (V extends number
      ?
          | { in: readonly number[] }
          | { gt: number }
          | { gte: number }
          | { lt: number }
          | { lte: number }
          | { gte: number; lte: number }
          | { gt: number; lt: number }
      : never);

/**
 * Localized-field operators. `lang` selects the language segment, so the clause
 * targets `mixins.<key>.<attr>.<lang>` (localized values are stored language-keyed).
 */
export type LocalizedOps =
  | { lang: string; eq: string }
  | { lang: string; in: readonly string[] }
  | { lang: string; regex: string }
  | { lang: string; exists: boolean };

/** A `where` entry: a bare value (equals), an operator object, or a localized operator object. */
export type MixinWhereValue<V> = V | MixinOps<V> | LocalizedOps;

/** Type-safe `where` map over a mixin's attributes. */
export type MixinWhere<T> = {
  [K in keyof T]?: MixinWhereValue<NonNullable<T[K]>>;
};

function makeFilter<E extends string>(fragment: string, usesCompound: boolean): MixinFilter<E> {
  return {
    usesCompound,
    toString: () => fragment,
    build: () => fragment,
  };
}

function formatScalar(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (/\s/.test(s)) {
    throw new Error(
      `mixinQuery: value "${s}" contains whitespace. The Emporix q DSL uses spaces as AND ` +
        `separators and the safe escaping is unverified — pass a whitespace-free value or use raw().`,
    );
  }
  return s;
}

function renderClause(path: string, val: unknown): string {
  if (val === null || typeof val !== "object") {
    return `${path}:${formatScalar(val)}`;
  }
  const o = val as Record<string, unknown>;
  if ("lang" in o) {
    const { lang, ...rest } = o;
    return renderClause(`${path}.${String(lang)}`, rest);
  }
  if ("exists" in o) return `${path}:${o.exists ? "exists" : "missing"}`;
  if ("eq" in o) return `${path}:${formatScalar(o.eq)}`;
  if ("in" in o) return `${path}:(${(o.in as unknown[]).map(formatScalar).join(",")})`;
  if ("regex" in o) return `${path}:~${String(o.regex)}`;
  const parts: string[] = [];
  if ("gte" in o) parts.push(`>=${String(o.gte)}`);
  if ("gt" in o) parts.push(`>${String(o.gt)}`);
  if ("lte" in o) parts.push(`<=${String(o.lte)}`);
  if ("lt" in o) parts.push(`<${String(o.lt)}`);
  if (parts.length === 0) {
    throw new Error(
      `mixinQuery: unsupported value for "${path}" (no operator keys; localized fields are not yet supported).`,
    );
  }
  if (parts.length === 1) return `${path}:${parts[0]}`;
  return `${path}:(${parts.join(" AND ")})`;
}

/** Builds a `q` filter for one mixin's attributes. Multiple keys are ANDed (space-joined). */
export function mixinQuery<T, E extends string>(
  descriptor: MixinDescriptor<T, E>,
  where: MixinWhere<T>,
  opts?: { prefix?: string },
): MixinFilter<E> {
  const base = opts?.prefix
    ? `${opts.prefix}.mixins.${descriptor.key}`
    : `mixins.${descriptor.key}`;
  const clauses: string[] = [];
  for (const attr of Object.keys(where)) {
    const val = (where as Record<string, unknown>)[attr];
    if (val === undefined) continue;
    clauses.push(renderClause(`${base}.${attr}`, val));
  }
  if (clauses.length === 0) {
    throw new Error(`mixinQuery: empty where for mixin "${descriptor.key}".`);
  }
  return makeFilter<E>(clauses.join(" "), false);
}

// `E` is pinned to the FIRST filter; the rest are `NoInfer` so they must match
// it exactly — composing filters from two different entities is a compile error.

/** Combines filters with AND. Space-joins unless a child is compound, then uses compoundLogicalQuery. */
export function and<E extends string>(
  first: MixinFilter<E>,
  ...rest: NoInfer<MixinFilter<E>>[]
): MixinFilter<E> {
  const filters = [first, ...rest];
  if (filters.some((f) => f.usesCompound)) {
    const inner = filters.map((f) => `(${f.toString()})`).join(" AND ");
    return makeFilter<E>(`compoundLogicalQuery:(${inner})`, true);
  }
  return makeFilter<E>(filters.map((f) => f.toString()).join(" "), false);
}

/** Combines filters with OR via compoundLogicalQuery (only valid on compound-capable services). */
export function or<E extends string>(
  first: MixinFilter<E>,
  ...rest: NoInfer<MixinFilter<E>>[]
): MixinFilter<E> {
  const inner = [first, ...rest].map((f) => `(${f.toString()})`).join(" OR ");
  return makeFilter<E>(`compoundLogicalQuery:(${inner})`, true);
}

/** Escape hatch: wrap a raw q fragment (e.g. a non-mixin clause). Entity-agnostic. */
export function raw(fragment: string): MixinFilter<any> {
  return makeFilter<any>(fragment, false);
}
```

- [ ] **Step 4: Export the builder from the package root**

In `packages/mixins/src/index.ts`, append:

```ts
export { mixinQuery, and, or, raw } from "./runtime/query";
export type { MixinFilter, MixinWhere, MixinWhereValue, MixinOps, LocalizedOps } from "./runtime/query";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-mixins exec vitest run tests/query.test.ts`
Expected: PASS (all cases).

Run: `pnpm -F @viu/emporix-mixins typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/mixins/src/runtime/query.ts packages/mixins/src/index.ts packages/mixins/tests/query.test.ts
git commit -m "feat(mixins): add type-safe mixin filter builder"
```

---

## Task 4: Type-level gating tests

**Files:**
- Create: `packages/mixins/tests/query-types.test.ts`

- [ ] **Step 1: Write the type-assertion test (verified by typecheck, not runtime)**

Create `packages/mixins/tests/query-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mixinQuery, and, or } from "../src/index";
import type { MixinDescriptor, MixinFilter } from "../src/index";

const PRODUCT: MixinDescriptor<{ color?: string; qty?: number }, "PRODUCT"> = {
  key: "attrs",
  entity: "PRODUCT",
  url: "u",
  version: 1,
};
const ORDER: MixinDescriptor<{ priority?: string }, "ORDER"> = {
  key: "ord",
  entity: "ORDER",
  url: "u",
  version: 1,
};

describe("type gating (compile-time)", () => {
  it("propagates the entity onto the filter and gates misuse", () => {
    // Entity literal flows through.
    const p: MixinFilter<"PRODUCT"> = mixinQuery(PRODUCT, { color: "Blue" });
    expect(p.toString()).toBe("mixins.attrs.color:Blue");

    // @ts-expect-error unknown attribute name
    mixinQuery(PRODUCT, { nope: "x" });

    // @ts-expect-error string attribute does not accept numeric range op
    mixinQuery(PRODUCT, { color: { gt: 1 } });

    // @ts-expect-error number attribute does not accept regex op
    mixinQuery(PRODUCT, { qty: { regex: "1" } });

    // @ts-expect-error string attribute cannot equal a number
    mixinQuery(PRODUCT, { color: 5 });

    // @ts-expect-error cannot AND filters from different entities
    and(mixinQuery(PRODUCT, { color: "Blue" }), mixinQuery(ORDER, { priority: "high" }));

    // @ts-expect-error cannot OR filters from different entities
    or(mixinQuery(PRODUCT, { color: "Blue" }), mixinQuery(ORDER, { priority: "high" }));
  });
});
```

- [ ] **Step 2: Run typecheck to verify the assertions hold**

Run: `pnpm -F @viu/emporix-mixins typecheck`
Expected: PASS — each `@ts-expect-error` is satisfied by a real error. If typecheck reports `Unused '@ts-expect-error' directive`, the gating is too loose; fix the types in `query.ts`/`types.ts` until it passes.

- [ ] **Step 3: Run the runtime portion**

Run: `pnpm -F @viu/emporix-mixins exec vitest run tests/query-types.test.ts`
Expected: PASS (the one runtime assertion).

- [ ] **Step 4: Commit**

```bash
git add packages/mixins/tests/query-types.test.ts
git commit -m "test(mixins): add compile-time gating tests for the filter builder"
```

---

## Task 5: `resolveQuery` normalizer in the SDK core

**Files:**
- Create: `packages/sdk/src/core/query.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/core/query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/core/query.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveQuery } from "../../src/core/query";

describe("resolveQuery", () => {
  it("passes a raw string through unchanged", () => {
    expect(resolveQuery("mixins.attrs.color:Blue", { compoundLogicalQuery: false })).toBe(
      "mixins.attrs.color:Blue",
    );
  });

  it("coerces a built filter via toString()", () => {
    const filter = { toString: () => "mixins.attrs.color:Blue", usesCompound: false };
    expect(resolveQuery(filter, { compoundLogicalQuery: false })).toBe("mixins.attrs.color:Blue");
  });

  it("allows a compound filter when the service supports it", () => {
    const filter = { toString: () => "compoundLogicalQuery:((a) OR (b))", usesCompound: true };
    expect(resolveQuery(filter, { compoundLogicalQuery: true })).toBe(
      "compoundLogicalQuery:((a) OR (b))",
    );
  });

  it("throws when a compound filter targets a non-compound service", () => {
    const filter = { toString: () => "compoundLogicalQuery:((a) OR (b))", usesCompound: true };
    expect(() => resolveQuery(filter, { compoundLogicalQuery: false })).toThrow(
      /does not support/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/core/query.test.ts`
Expected: FAIL — `../../src/core/query` does not exist.

- [ ] **Step 3: Write the normalizer**

Create `packages/sdk/src/core/query.ts`:

```ts
/**
 * A built query filter — structurally matched, NOT imported, so the SDK stays
 * decoupled from `@viu/emporix-mixins` (which lists the SDK as an optional
 * peer; a real import would be circular). `@viu/emporix-mixins`' `MixinFilter<E>`
 * satisfies this shape.
 */
export interface BuiltQuery<E extends string = string> {
  toString(): string;
  readonly usesCompound?: boolean;
  /** Phantom entity tag — gates which service a filter may be passed to. */
  readonly __entity?: E;
}

/** A `q` value a service method accepts: a raw DSL string or a built filter for entity `E`. */
export type QueryFor<E extends string = string> = string | BuiltQuery<E>;

/** Per-service capability flags consulted by {@link resolveQuery}. */
export interface QueryCapability {
  /** Whether the target service supports the `compoundLogicalQuery` (OR) operator. */
  compoundLogicalQuery: boolean;
}

/**
 * Normalizes a `string | BuiltQuery` into a `q` string and enforces the
 * `compoundLogicalQuery` capability gate: an `or()`-built filter passed to a
 * service that does not support it throws rather than silently producing a
 * query the backend cannot execute.
 */
export function resolveQuery(q: QueryFor, cap: QueryCapability): string {
  if (typeof q === "string") return q;
  if (q.usesCompound === true && !cap.compoundLogicalQuery) {
    throw new Error(
      "This filter uses or()/compoundLogicalQuery, which the target service does not support. " +
        "Combine conditions with and() (space-separated AND) instead.",
    );
  }
  return q.toString();
}
```

- [ ] **Step 4: Export from the SDK package root**

In `packages/sdk/src/index.ts`, add after the `iterateAll` export line (`export { iterateAll } from "./core/context";`):

```ts
export { resolveQuery } from "./core/query";
export type { QueryFor, BuiltQuery, QueryCapability } from "./core/query";
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/core/query.test.ts`
Expected: PASS

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/query.ts packages/sdk/src/index.ts packages/sdk/tests/core/query.test.ts
git commit -m "feat(core): add resolveQuery normalizer with compoundLogicalQuery gate"
```

---

## Task 6: `ProductService.search` accepts a built filter

**Files:**
- Modify: `packages/sdk/src/services/product.ts` (imports + `search()` method)
- Test: `packages/sdk/tests/services/product.test.ts` (add a `describe` block)

- [ ] **Step 1: Write the failing test**

In `packages/sdk/tests/services/product.test.ts`, add this block at the end of the file (after the last `describe`):

```ts
describe("ProductService.search — built filters", () => {
  it("accepts a built filter and sends its toString() as q", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }]);
      }),
    );
    const filter = { toString: () => "mixins.attrs.color:Blue", usesCompound: false };
    await svc().search(filter);
    expect((seen as URLSearchParams | null)?.get("q")).toBe("mixins.attrs.color:Blue");
  });

  it("allows a compound (or()) filter because Product supports compoundLogicalQuery", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }]);
      }),
    );
    const filter = {
      toString: () => "compoundLogicalQuery:((mixins.attrs.color:Blue) OR (mixins.attrs.color:Black))",
      usesCompound: true,
    };
    await svc().search(filter);
    expect((seen as URLSearchParams | null)?.get("q")).toBe(filter.toString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/product.test.ts`
Expected: FAIL — `search()` is typed `query: string`, so passing an object is a type error (and at runtime the object would be sent as `[object Object]`).

- [ ] **Step 3: Update `search()` to use `resolveQuery`**

In `packages/sdk/src/services/product.ts`, add the import near the other `../core/*` imports:

```ts
import { resolveQuery, type QueryFor } from "../core/query";
```

Replace the `search()` method with:

```ts
  /**
   * Searches products by a `q` filter — a raw Emporix DSL string or a built
   * filter (e.g. `@viu/emporix-mixins`' `mixinQuery(...)`). Product supports
   * `compoundLogicalQuery`, so `or()` filters are allowed.
   */
  async search(
    query: QueryFor<"PRODUCT">,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const q = resolveQuery(query, { compoundLogicalQuery: true });
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.req<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { q, pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/product.test.ts`
Expected: PASS — both new cases plus all existing product tests (string queries still work: `search("name:Foo")`, `searchByName`, `listVariantChildren`).

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product.test.ts
git commit -m "feat(product): accept a built mixin filter in products.search"
```

---

## Task 7: `useProductSearch` accepts a built filter

**Files:**
- Modify: `packages/react/src/hooks/use-products.ts` (`useProductSearch`)
- Test: `packages/react/tests/use-products.test.tsx` (extend the `useProductSearch` describe)

- [ ] **Step 1: Write the failing test**

In `packages/react/tests/use-products.test.tsx`, inside `describe("useProductSearch", ...)` (after the existing `it("forwards query and pagination params", ...)`), add:

```ts
  it("accepts a built filter and sends its string as q", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }]);
      }),
    );
    const filter = { toString: () => "mixins.attrs.color:Blue", usesCompound: false };
    const { result } = renderHook(() => useProductSearch(filter), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.items?.length).toBe(1));
    expect(seenQuery?.get("q")).toBe("mixins.attrs.color:Blue");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-products.test.tsx`
Expected: FAIL — `useProductSearch` is typed `query: string | undefined`, so passing an object is a type error.

- [ ] **Step 3: Widen `useProductSearch`**

In `packages/react/src/hooks/use-products.ts`, add to the top-level `@viu/emporix-sdk` import:

```ts
import { type PaginatedItems, type Product, type QueryFor } from "@viu/emporix-sdk";
```

Replace `useProductSearch` with:

```ts
/** Product search. Accepts a raw `q` string or a built filter. Disabled when empty. */
export function useProductSearch(
  query: QueryFor<"PRODUCT"> | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const qStr = typeof query === "string" ? query : (query?.toString() ?? "");
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "product-search", args: [qStr, params],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: qStr.trim() !== "",
    queryFn: (ctx) => client.products.search(query as QueryFor<"PRODUCT">, params, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}
```

(Note: the cache key now uses `qStr` — the built string — so filter objects produce stable keys.)

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-products.test.tsx`
Expected: PASS — the new case plus the existing string-query and empty-query cases.

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-products.ts packages/react/tests/use-products.test.tsx
git commit -m "feat(react): accept a built mixin filter in useProductSearch"
```

---

## Task 8: Docs + changeset

**Files:**
- Create: `docs/mixin-search.md`
- Create: `.changeset/mixin-filter-builder.md`

- [ ] **Step 1: Write the docs**

Create `docs/mixin-search.md`:

```markdown
# Searching by mixin (custom) fields

Mixins are namespaced custom fields stored under `<entity>.mixins.<schemaKey>.<attribute>`.
The Emporix `q` query parameter filters by these fields. `@viu/emporix-mixins` provides a
type-safe builder that turns a generated `MixinDescriptor` into a `q` filter.

## Build a filter

```ts
import { mixinQuery, and, or, raw } from "@viu/emporix-mixins";
import { mixins } from "./generated/mixins/registry"; // from `emporix-mixins generate`

// Equals, range, in-list, regex, exists:
const q = mixinQuery(mixins.attrs, {
  color: "Blue",                       // equals
  qty: { gte: 10, lte: 20 },           // range
  size: { in: ["S", "M"] },            // in-list
  note: { regex: "sale" },             // regex
  promo: { exists: true },             // present
  title: { lang: "en", eq: "Sale" },   // localized → mixins.attrs.title.en:Sale
});

// Combine: and() is space-joined AND; or() needs a compound-capable service.
const q2 = or(
  mixinQuery(mixins.attrs, { color: "Blue" }),
  mixinQuery(mixins.attrs, { color: "Black" }),
);
```

## Use it

```ts
import { useProductSearch } from "@viu/emporix-sdk-react";

const { data } = useProductSearch(q);          // React
const page = await client.products.search(q);  // SDK
```

## Capability matrix

| Service | mixin `q` filter | `or()` (`compoundLogicalQuery`) | In the SDK today |
|---|---|---|---|
| Product | yes | **yes** | `products.search` / `useProductSearch` |
| Order, Customer, Cart, Category, Price | yes | no (use `and()` only) | added in the service-rollout plan |
| Approval, Availability, Quote, Schema | yes | **yes** | passthrough / rollout plan |

Passing an `or()` filter to a service that does not support `compoundLogicalQuery` throws.

## Localized fields

Localized attributes are stored language-keyed. Add `lang` to target one language —
the builder appends the language segment to the path:

```ts
mixinQuery(mixins.attrs, { title: { lang: "en", regex: "sale" } });
// → mixins.attrs.title.en:~sale
```

## Limitations (this release)

- **Values containing whitespace** throw (the safe `q` escaping is unverified) — use `raw()`.
- `exists`/`missing` is emitted at the attribute path; confirm attribute-level semantics on your tenant.
- The localized indexed path (`mixins.<key>.<attr>.<lang>`) should be confirmed against your tenant.
```

- [ ] **Step 2: Write the changeset**

Create `.changeset/mixin-filter-builder.md`:

```markdown
---
"@viu/emporix-mixins": minor
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add a type-safe mixin filter builder. `@viu/emporix-mixins` now exports
`mixinQuery`/`and`/`or`/`raw` to build Emporix `q` filters from generated
`MixinDescriptor`s, with attribute names and value types checked at compile
time and the entity carried through `MixinDescriptor<T, E>` / `MixinFilter<E>`.
`products.search` and `useProductSearch` accept a built filter (or a raw
string); a new `resolveQuery` normalizer enforces the `compoundLogicalQuery`
(OR) capability gate per service.
```

- [ ] **Step 3: Verify the changeset is recognized**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-mixins`, `@viu/emporix-sdk`, `@viu/emporix-sdk-react` as `minor`.

- [ ] **Step 4: Commit**

```bash
git add docs/mixin-search.md .changeset/mixin-filter-builder.md
git commit -m "docs(docs): document mixin filter builder and add changeset"
```

---

## Final verification

- [ ] **Run the full per-package suites + repo typecheck/lint**

```bash
pnpm -F @viu/emporix-mixins test
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk-react test
pnpm typecheck
pnpm lint
```
Expected: all PASS. (If examples typecheck against built `dist/`, run `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` first — but examples do not use the new API, so this is only a precaution.)

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Builder `mixinQuery`/`and`/`or`/`raw` + `MixinFilter`/`MixinWhere` → Task 3 ✓
- Entity gating (`MixinDescriptor<T, E>`, `MixinFilter<E>`, phantom `__entity`, mixed-entity compile errors) → Tasks 1, 4 ✓
- Codegen emits entity literal → Task 2 ✓
- `resolveQuery` + `QueryFor`/`BuiltQuery` + OR capability gate, structurally decoupled → Task 5 ✓
- Product `search` + `useProductSearch` accept built filters; stable cache key → Tasks 6, 7 ✓
- DSL mapping (eq/range/in/regex/exists/missing/boolean/prefix/AND/OR) + whitespace fail-loud (Q1) → Task 3 ✓
- Localized fields via `{ lang, ... }` operator → Task 3 ✓
- Docs + changeset → Task 8 ✓
- **Deferred (documented):** attribute-level exists/missing confirmation (Q2), date ranges, and the non-Product service rollout → Plan 2.

**Placeholder scan:** none — every code step contains complete code.

**Type consistency:** `MixinFilter<E>` (toString/build/usesCompound/__entity) is structurally assignable to the SDK's `BuiltQuery<E>`; `QueryFor<E>` is used identically in `product.ts`, the SDK index, and `use-products.ts`; `resolveQuery(query, { compoundLogicalQuery: true })` matches its `QueryCapability` signature.
