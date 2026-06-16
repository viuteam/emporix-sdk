# Mixin Filter Builder — Design

- **Date:** 2026-06-16
- **Status:** Approved (design), pending implementation plan
- **Packages affected:** `@viu/emporix-mixins` (primary), `@viu/emporix-sdk`, `@viu/emporix-sdk-react`
- **Related:** `docs/superpowers/specs/2026-06-08-emporix-mixins-design.md` (typed mixin values), `docs/schema.md`

## Problem

Custom fields in Emporix are **mixins** — namespaced objects stored under
`<entity>.mixins.<schemaKey>.<attribute>`, with the schema URL recorded under
`<entity>.metadata.mixins.<schemaKey>`. Mixins are **not product-specific**: Emporix supports
them on many entities (Product, Category, Customer, Customer Address, Order, Cart, Price /
Price List, Quote, Vendor, Company, Coupon, Return, Site, Availability, Shopping List, Custom
Segments, IAM Groups). Many Emporix services let you filter their list/search endpoints by
these fields through the `q` query parameter, using a uniform grammar, e.g.:

```
GET /product/{tenant}/products?q=mixins.productCustomAttributes.color:Blue
POST /order/{tenant}/salesorders/search   { "q": "mixins.generalAttributes.priority:high" }
```

Today this only works by passing a **raw, untyped DSL string**, and in the SDK it is only
reachable through `ProductService.search()`. There is no type safety on the attribute path or
value, escaping is the caller's problem, and the same capability is not surfaced for the other
mixin-bearing entities.

This design adds a **generic, type-safe mixin filter builder** that produces a correct `q`
fragment from an existing `MixinDescriptor<T>` (which already knows the schema `key`, `entity`,
`version`, and a phantom `__type`), plus a uniform way to feed that fragment into any SDK
list/search method that accepts `q`. Product search is the first consumer, not the only one.

### What already exists (and is NOT this)

- `@viu/emporix-mixins` runtime: `readMixin` / `writeMixin` / `validateMixin` /
  `savedMixinVersion` — typed read/write/validate of mixin **values** on an entity.
- `@viu/emporix-mixins` codegen/CLI: generates typed interfaces + a `MixinDescriptor` registry
  per entity from schemas, with lockfile drift detection.
- SDK `client.schemas.*` Schema Service and `ProductService.search(q)` /
  `useProductSearch(q)` (raw string passthrough).

None of these build a type-safe **filter** against mixin fields, on any entity. This design
adds exactly that, reusing the existing `MixinDescriptor` as the type source.

## Goals

- **Entity-generic, type-safe** construction of Emporix `q` filters for mixin attributes,
  driven by `MixinDescriptor<T>` so attribute names and value types are checked at compile time.
- **Centralize DSL formatting/escaping** in one place instead of every call site.
- **Capability-aware**: the builder/integration must never silently emit a query a target
  service cannot execute — specifically the `compoundLogicalQuery` (OR) restriction.
- **Compose uniformly** with SDK list/search methods through a single normalization helper, so
  any q-capable method can opt in the same way (not a product-only hack).

## Non-Goals (YAGNI)

- **Algolia / Indexing Service faceted search** — the Emporix-recommended path for
  customer-facing faceted browsing, full-text, relevance ranking. Separate architecture and
  operational track. Out of scope.
- **A generic scalar `filters` layer** for arbitrary non-mixin fields. The `raw()` escape hatch
  covers occasional non-mixin clauses; a full scalar query DSL is not built here.
- **`sort` / `expand` / `fields` query-param wrappers.** Adjacent gap, separate PR.
- **Schema Service custom-instance filtering.** Custom Instances store typed attributes as
  top-level fields, **not** under `mixins.<key>` — so the mixin path model does not apply.
  Explicitly excluded.
- **IAM Groups mixin filtering.** Groups use a non-standard `mixins.<key>` structure without
  `metadata.mixins`, and no `q` endpoint is documented. Excluded.

## Architecture & Data Flow

The builder lives in `@viu/emporix-mixins`, runtime entry (`.`) — browser-safe, no `ajv`, no
`@viu/emporix-sdk` dependency. It owns `MixinDescriptor` already. It **only builds a `q`
string**; it never touches the network and is unaware of which service the string targets.

The SDK gains a tiny shared normalizer, `resolveQuery()`, in `packages/sdk/src/core`, which
turns `string | MixinFilter` into a `q` string and enforces the per-service capability gate
(see below). Every q-capable service method routes its `q` through it.

```
MixinDescriptor<T> (key, entity, __type) ─┐
where: MixinWhere<T> (keyof T, typed ops)  ─┤→ mixinQuery() ─→ MixinFilter ─┐
                                            │   and()/or()/raw() ───────────┤
                                            └────────────────────────────── ┤
                                                                             ▼
                          resolveQuery(filter, serviceCapability) ─→ q string ─→ service list/search
```

## Public API (new, in `@viu/emporix-mixins`)

```ts
mixinQuery<T>(
  descriptor: MixinDescriptor<T>,
  where: MixinWhere<T>,
  opts?: { prefix?: string },   // for embedded mixins, e.g. prefix:"customer" → customer.mixins.<key>.<attr>
): MixinFilter

and(...filters: MixinFilter[]): MixinFilter   // space-joined (implicit AND) — universal
or(...filters: MixinFilter[]): MixinFilter     // compoundLogicalQuery:((…) OR (…)) — capability-gated
raw(fragment: string): MixinFilter             // escape hatch for non-mixin clauses

interface MixinFilter {
  toString(): string;          // the q fragment, parenthesized when compound
  build(): string;             // alias; the top-level q string (no wrapping parens)
  readonly usesCompound: boolean;  // true if this filter contains a compoundLogicalQuery (or())
}
```

- `MixinWhere<T>` maps each attribute key `K in keyof T` to either a **bare value** (= `eq`) or
  an **operator object**, constrained by the attribute's value type:

  | `T[K]` type | Allowed forms |
  |---|---|
  | `string` | bare value (eq), `{ eq }`, `{ in: string[] }`, `{ regex: string }`, `{ exists: boolean }` |
  | `number` | bare value (eq), `{ eq }`, `{ gt }`, `{ gte }`, `{ lt }`, `{ lte }`, `{ in }`, range via `{ gte, lte }`, `{ exists }` |
  | `boolean` | bare value (eq), `{ eq }`, `{ exists }` |
  | localized (object map) | `{ <lang>: value }` form, or a `{ lang, eq }` shape — see Localized fields |

- An invalid attribute name or a type-incompatible operator is a **compile error**.
- `usesCompound` lets the SDK reject `or()`-containing filters against services that do not
  support `compoundLogicalQuery`, without the builder needing to know the target service.

## DSL Mapping

`<key>` is `descriptor.key`; default path = `mixins.<key>.<attribute>` (with an optional
`prefix.` in front for embedded mixins).

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
| localized: `{ title: { en: "Sale" } }` | `mixins.<key>.title.en:Sale` |
| embedded: `prefix:"customer"` | `customer.mixins.<key>.<attr>:…` |
| multiple keys in one `mixinQuery` | clauses space-joined (AND) |
| `or(a, b)` | `compoundLogicalQuery:((<a>) OR (<b>))` |
| `and(a, b)` | `<a> <b>` (children parenthesized if themselves compound) |

### Value formatting / escaping (centralized — the core value-add)

- **Strings**: emitted as-is; case-sensitive exact match. Values containing spaces are wrapped
  so the top-level space (which means AND) does not split the clause — see open question Q1.
- **Booleans**: `true` / `false`. **Numbers**: literal.
- **Dates** (ISO-8601 for date attributes): double-quoted, e.g.
  `(>="2021-05-18T07:27:27.455Z" AND <"2021-05-20T...")`.
- **Regex** (`regex` op): `~` prefix. **`in` lists**: `(v1,v2,v3)`.
- **Localized fields**: declared `localized` in the schema → stored as a language-keyed map →
  must be queried as `mixins.<key>.<attr>.<lang>:<value>`. The builder appends the language
  segment; see open question Q3.

## Platform support — capability matrix (verified against Emporix docs)

`compoundLogicalQuery` (OR / nested AND) is supported on **exactly**: Approval, Availability,
Product, Quote, Schema (per the canonical
`developer.emporix.io/api-references/standard-practices/q-param`). Everywhere else, conditions
can only be combined by **space-separated implicit AND**; there is no documented cross-field OR.

| Entity / Service | Carries mixins | `q` filter on mixin path | `compoundLogicalQuery` | Caller-controlled `q` in SDK today |
|---|---|---|---|---|
| Product | yes | yes (canonical) | **yes** | yes (`products.search`) |
| Order / SalesOrder | yes | yes (doc example: `mixins.…:exists`, `customer.mixins.…`) | no | no (list filters only) |
| Customer | yes | yes (POST `/customers/search`, Nov 2025) | no | only via CustomerAdmin passthrough |
| Category | yes | yes (Nov 2025) | no | no |
| Cart | yes | yes (POST `/carts/search`) | no | no |
| Price / Price List | yes | yes (2025) | no | no |
| Availability | yes | yes — **`q` in POST body, mutually exclusive with `site`** | **yes** | no |
| Quote | yes | yes | **yes** | no (service may be absent) |
| Approval | no | n/a | **yes** | yes (passthrough) |
| Schema custom instances | n/a (top-level fields) | not via `mixins.` path | **yes** | yes (passthrough) — **excluded** |
| Vendor / Segment / Fee | mixed/no | passthrough `q` | no | yes (passthrough) |
| Shopping List, IAM Groups, Returns, Coupon, Client-Mgmt Locations | yes | **no documented `q`** | no | no — **excluded** |

## SDK / React integration

### Shared normalizer (new, `packages/sdk/src/core`)

```ts
type QueryInput = string | { toString(): string; usesCompound?: boolean };

function resolveQuery(q: QueryInput, cap: { compoundLogicalQuery: boolean }): string;
// throws a clear error if (typeof q !== "string") && q.usesCompound && !cap.compoundLogicalQuery
```

Structurally decoupled — the SDK does not import the mixin type; it accepts anything
string-coercible exposing an optional `usesCompound` flag. Each service declares its own
capability constant.

### Phased rollout (recommended)

- **Phase 1 (this work):**
  - `ProductService.search(query: string | MixinFilter, …)` + `useProductSearch(query: string | MixinFilter, …)` via `resolveQuery` (Product supports compoundLogicalQuery → `or()` allowed).
  - Methods that already pass a caller-controlled `q` through a query dict accept `string | MixinFilter` the same way: Approval, Schema (`listSchemas`/`listInstances`), CustomerAdmin, Vendor, Segment, Fee. (Schema custom instances stay raw-string only — mixin path model excluded.)
- **Phase 2 (follow-up PRs, prioritized by mixin-bearing + q-capable):** add caller-controlled
  `q` to `Customer` (search), `Category`, `Cart` (search), `Order`/`SalesOrder` (search),
  `Price`. `Availability` is a special case (q in body, exclusive with `site`) — handle
  separately when needed.

The React layer mirrors only what the SDK exposes; query keys derive from the **built string**
so caches stay stable. No new hooks.

## Type-safety considerations

- **Entity gating (optional, recommended):** because `MixinDescriptor` carries `entity`, a
  service method could constrain accepted descriptors to its entity (e.g. product search only
  accepts `MixinDescriptor<…, "PRODUCT">`). Decide during planning whether to add an entity
  type parameter to `MixinDescriptor`; if not, this stays a runtime/no-op concern.
- **OR gating** is enforced at runtime via `usesCompound` + `resolveQuery` (above).

## Testing strategy (TDD)

- **Builder unit tests** (`packages/mixins/tests/`): exact `q`-string assertions per operator,
  AND/OR nesting, `prefix`, localized path, `raw()` composition, escaping. Type-level tests
  (`// @ts-expect-error`) for invalid attribute names and type-incompatible operators.
- **`resolveQuery` tests**: string passthrough; `MixinFilter` coercion; throws when an
  `or()`-containing filter targets a non-compound service.
- **SDK / React** (Vitest + MSW): each opted-in method accepts a `MixinFilter` and emits the
  expected `q`; OR-gating error surfaces on non-compound services.
- **Live/e2e smoke** against the `viu` tenant for at least Product, to confirm DSL semantics
  end-to-end (the open questions below).

## Open questions — verify empirically during implementation

1. **Spaces inside string values** (e.g. `"1000 GB"`): a top-level space is the AND separator,
   so such values must be wrapped/escaped; the exact wrapping the backend accepts must be
   confirmed against the tenant. Until confirmed, fail loudly rather than emit a wrong query.
2. **Attribute-level `exists`/`missing`**: docs document these only at the namespace level
   (`mixins.<key>:exists`). Verify `mixins.<key>.<attr>:exists`; if unsupported, expose
   namespace-level existence via a dedicated helper and document the caveat.
3. **Localized mixin path**: confirm `mixins.<key>.<attr>.<lang>:<value>` is the correct
   indexed path for `localized` mixin attributes, and that the codegen marks localized
   attributes distinguishably in the generated type.
4. **Classification mixins** (`mixins.class_<categoryCode>_<name>.<attr>`): confirm the codegen
   emits the `class_…` schema key as `descriptor.key`, so the builder needs no special-casing.
5. **Mixin indexing depth on newer services** (Category/Customer/Cart, added 2025): the q
   grammar references mixin paths, but per-service indexing of arbitrary mixin fields is not
   documented in detail — verify before relying on it in Phase 2.

## Constraints & gotchas (from Emporix docs)

- A mixin field only matches products/entities that actually store it; entities on an older
  schema version silently won't match attributes added later.
- Cross-field OR requires `compoundLogicalQuery` (Approval, Availability, Product, Quote,
  Schema only). Elsewhere, only space-separated AND; in-list `(a,b)` gives OR across values of
  a single field.
- Reads require a bearer token; unpublished products need `product.product_read_unpublished`.
- Availability search puts `q` in the body and forbids the `site` query param alongside it.

## Release

- Changeset: `@viu/emporix-mixins` minor (builder API); `@viu/emporix-sdk` and
  `@viu/emporix-sdk-react` minor (`resolveQuery` + opted-in methods accept `string | MixinFilter`).
- Docs: a `docs/mixin-search.md` with builder usage + the capability matrix; cross-link from
  `docs/schema.md`.
