# Mixin Filter Builder — Design

- **Date:** 2026-06-16
- **Status:** Approved (design), pending implementation plan
- **Packages affected:** `@viu/emporix-mixins` (primary), `@viu/emporix-sdk`, `@viu/emporix-sdk-react`
- **Related:** `docs/superpowers/specs/2026-06-08-emporix-mixins-design.md` (typed mixin values), `docs/schema.md`

## Problem

Products in Emporix carry custom fields as **mixins** — namespaced objects under
`product.mixins.<schemaKey>.<attribute>`, with the schema URL recorded under
`product.metadata.mixins.<schemaKey>`. The Emporix Product Service can filter products by
these fields through the `q` query parameter, e.g.:

```
GET /product/{tenant}/products?q=mixins.productCustomAttributes.color:Blue
```

Today this already works through the SDK, but only by passing a **raw, untyped DSL string**:

```ts
client.products.search("mixins.deliveryOptions.packaging:Paper");
```

This is fragile: the caller must know the exact dotted path, hand-build operator syntax,
get the escaping right (spaces, dates, regex), and there is no compile-time check that the
attribute name or value type is valid. The repo already ships `@viu/emporix-mixins`, which
generates **typed mixin descriptors** (`MixinDescriptor<T>` carrying `key`, `url`, `version`,
and a phantom `__type`) and per-mixin TypeScript interfaces — but nothing in the repo turns
those descriptors into product **search filters**. That is the gap this design closes.

### What already exists (and is NOT this)

- `@viu/emporix-mixins` runtime: `readMixin` / `writeMixin` / `validateMixin` /
  `savedMixinVersion` — typed read/write/validate of mixin **values** on an entity.
- `@viu/emporix-mixins` codegen/CLI (`pull`/`generate`/`check`): generates typed interfaces
  + a `MixinDescriptor` registry from schemas, with lockfile drift detection.
- SDK `client.schemas.*` Schema Service: CRUD on schemas, custom entities, custom instances
  (`searchInstances` searches **custom instances**, not product-embedded mixins).
- `ProductService.search(q)` / `useProductSearch(q)`: pass a raw `q` string through.

None of these build a type-safe **filter** against product mixin fields. This design adds
exactly that, reusing the existing `MixinDescriptor` as the type source.

## Goals

- Type-safe construction of Product Service `q` filters for mixin attributes, driven by the
  existing `MixinDescriptor<T>` so attribute names and value types are checked at compile time.
- Centralize DSL formatting/escaping in one place instead of every call site.
- Compose cleanly with the existing `client.products.search()` / `useProductSearch()`.
- No new endpoint, no new network dependency in the builder.

## Non-Goals (YAGNI)

- **Algolia / Indexing Service faceted search** — the Emporix-recommended path for
  customer-facing faceted browsing, full-text, and relevance ranking. Separate architecture,
  separate operational track. Out of scope.
- **A generic scalar `filters` layer** on `ProductService` for arbitrary (non-mixin) fields.
  Occasional non-mixin clauses are covered by the `raw()` escape hatch.
- **`sort` / `expand` / `fields` query-param wrappers** on `ProductService`. Adjacent gap,
  separate PR.
- **A dedicated React hook** (`useProductMixinSearch`). Extending `useProductSearch` to accept
  a filter object is sufficient.

## Architecture & Data Flow

The builder lives in `@viu/emporix-mixins`, runtime entry (`.`) — browser-safe, no `ajv`,
no `@viu/emporix-sdk` dependency. It owns `MixinDescriptor` already. It **only builds a
`q` string**; it never touches the network.

```
MixinDescriptor<T> (key, __type) ─┐
where: MixinWhere<T> (keyof T,    ─┤→ mixinQuery() ─→ MixinFilter ─┐
        type-checked operators)    │   and()/or()/raw() ───────────┤→ String(q)
                                    └───────────────────────────────┘→ products.search(q)
                                                                       useProductSearch(q)
```

## Public API (new, in `@viu/emporix-mixins`)

```ts
mixinQuery<T>(descriptor: MixinDescriptor<T>, where: MixinWhere<T>): MixinFilter
and(...filters: MixinFilter[]): MixinFilter   // space-joined (implicit AND)
or(...filters: MixinFilter[]): MixinFilter    // compoundLogicalQuery:((…) OR (…))
raw(fragment: string): MixinFilter            // escape hatch for non-mixin clauses

interface MixinFilter {
  toString(): string;   // the q fragment, parenthesized when compound
  build(): string;      // alias; the top-level q string (no wrapping parens)
}
```

`MixinWhere<T>` maps each attribute key `K in keyof T` to either a **bare value** (treated as
`eq`) or an **operator object**, with operators constrained by the attribute's value type:

| `T[K]` type | Allowed forms |
|---|---|
| `string` | bare value (eq), `{ eq }`, `{ in: string[] }`, `{ regex: string }`, `{ exists: boolean }` |
| `number` | bare value (eq), `{ eq }`, `{ gt }`, `{ gte }`, `{ lt }`, `{ lte }`, `{ in: number[] }`, range via `{ gte, lte }`, `{ exists }` |
| `boolean` | bare value (eq), `{ eq }`, `{ exists }` |

An invalid attribute name or a type-incompatible operator is a **compile error**.

## DSL Mapping

`<key>` is `descriptor.key`. Path = `mixins.<key>.<attribute>`.

| `where` clause | Emitted `q` fragment |
|---|---|
| `{ packaging: "Paper" }` | `mixins.<key>.packaging:Paper` |
| `{ qty: { gt: 20 } }` | `mixins.<key>.qty:>20` |
| `{ weight: { gte: 10, lte: 20 } }` | `mixins.<key>.weight:(>=10 AND <=20)` |
| `{ color: { in: ["Blue","Black"] } }` | `mixins.<key>.color:(Blue,Black)` |
| `{ note: { regex: "urgent" } }` | `mixins.<key>.note:~urgent` |
| `{ inStock: true }` | `mixins.<key>.inStock:true` |
| `{ warranty: { exists: true } }` | `mixins.<key>.warranty:exists` |
| `{ warranty: { exists: false } }` | `mixins.<key>.warranty:missing` |
| multiple keys in one `mixinQuery` | clauses space-joined (AND) |
| `or(a, b)` | `compoundLogicalQuery:((<a>) OR (<b>))` |
| `and(a, b)` | `<a> <b>` (children parenthesized if themselves compound) |

### Value formatting / escaping (centralized — the core value-add)

- **Strings**: emitted as-is; case-sensitive exact match. Values containing spaces are wrapped
  so the top-level space (which means AND) does not split the clause — see open question Q1.
- **Booleans**: `true` / `false`.
- **Numbers**: literal.
- **Dates** (ISO-8601 strings passed for date attributes): double-quoted, e.g.
  `metadata.createdAt:(>="2021-05-18T07:27:27.455Z" AND <"2021-05-20T...")`.
- **Regex** (`regex` operator): `~` prefix on the value.
- **`in` lists**: comma-separated inside parentheses, `(v1,v2,v3)`.

## SDK / React integration (minimal)

- `ProductService.search(query: string | MixinFilter, params?, auth?)` — normalize with
  `typeof query === "string" ? query : query.toString()`. Structurally decoupled: the SDK does
  **not** import the mixin type; it accepts anything string-coercible via `toString()`.
- `useProductSearch(query: string | MixinFilter, params?, options?)` — same normalization. The
  React-Query key derives from the **built string**, so cache keys stay stable and correct.
  No new hook.

## Testing strategy (TDD)

- **Builder unit tests** (`packages/mixins/tests/`): exact `q`-string assertions for every
  operator, AND/OR nesting, `raw()` composition, and escaping rules. Type-level tests using
  `// @ts-expect-error` for invalid attribute names and type-incompatible operators.
- **SDK / React** (Vitest + MSW): `search` / `useProductSearch` accept a `MixinFilter`; assert
  the outgoing `q` query param equals the built string.
- **One live/e2e smoke** against the `viu` tenant to confirm DSL semantics end-to-end,
  specifically the two open questions below.

## Open questions — to verify empirically during implementation

1. **Spaces inside string values** (e.g. `"1000 GB"`): a top-level space is the AND separator,
   so a value with a space must be wrapped/escaped. The exact wrapping that the Product Service
   accepts (parentheses vs. quoting) must be confirmed against the `viu` tenant before fixing
   the escaping rule. Until confirmed, the builder should fail loudly (or document the
   limitation) rather than emit a silently-wrong query.
2. **Attribute-level `exists` / `missing`**: the Emporix docs only document these at the mixin
   **namespace** level (`mixins.<key>:exists`). Whether `mixins.<key>.<attr>:exists` behaves as
   expected must be verified. If unsupported, expose namespace-level existence via a dedicated
   helper and document the attribute-level caveat.

## Constraints & gotchas (from Emporix docs)

- A mixin field only matches products that actually store it; products on an older schema
  version silently won't match attributes added in a newer version.
- Top-level OR requires `compoundLogicalQuery` (Product Service supports it); space-separated
  clauses are always AND.
- `GET /product/{tenant}/products` requires a bearer token (anonymous or customer); reading
  unpublished products needs the `product.product_read_unpublished` scope.

## Release

- Changeset: `@viu/emporix-mixins` minor (new builder API); `@viu/emporix-sdk` and
  `@viu/emporix-sdk-react` minor (`search` / `useProductSearch` accept `string | MixinFilter`).
- Docs: extend `docs/mixins`/`docs/schema.md` (or a new `docs/mixin-search.md`) with builder
  usage examples.
