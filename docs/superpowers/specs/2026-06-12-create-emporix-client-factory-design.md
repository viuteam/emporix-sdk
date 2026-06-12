# `createEmporixClient` — tree-shakeable client factory (Roadmap row 9)

## Problem

Roadmap row 9 from the 2026-06-11 review (§5.1, *Performance & Tree-Shaking*). `EmporixClient`'s constructor (`packages/sdk/src/client.ts:131-226`) statically imports and **eagerly instantiates all ~46 services**. Because the imports are static and referenced, no bundler can drop an unused service — every consumer carries the full service surface in their bundle floor, even if they only call `products.get`.

A *lazy getter* does **not** fix this: the `import { CartService } from "./services/cart"` at the top of `client.ts` stays and is referenced by the getter, so the module is still bundled. The only way to actually tree-shake is to let the **consumer** import just the services they use. (Confirmed during brainstorming — lazy getters were rejected as a non-solution.)

This is a 🟢 optimization (no production blocker), valuable for bundle-size-sensitive storefronts.

## Goal

Add an **additive, opt-in** factory `createEmporixClient(config, services)` where the consumer passes only the service classes they need. The factory shares all the core infrastructure with `EmporixClient` but imports **no services itself**, so a consumer who uses the factory (and does not reference `EmporixClient`) tree-shakes every service they didn't pass.

**`EmporixClient` stays byte-for-byte behavior-identical** as the batteries-included default — existing consumers are unaffected. This makes the change **additive (minor)**, not the breaking "Major-Release" the review pencilled in for the more aggressive lazy-getter rewrite.

## Non-goals

- No change to `EmporixClient`'s public API or behavior.
- No change to any service's own API.
- No dynamic `import()` (would force an async client API).

## Architecture

Three modules, split so the factory never pulls in the service list:

### 1. `core/create-core.ts` — shared infrastructure (no service imports)

Extract the non-service half of today's constructor (`client.ts:131-176`) into:

```ts
export interface EmporixCore {
  readonly tenant: string;
  readonly config: ResolvedConfig;
  readonly tokenProvider: TokenProvider;
  /** Builds a per-service ClientContext (logger child + HttpClient). */
  mk: (service: ServiceName) => ClientContext;
  /** The exact non-service public surface EmporixClient exposes today
   *  (client.ts:238-273) — moved verbatim onto the core: */
  setStorefrontContext: (ctx: { currency?: string; siteCode?: string; targetLocation?: string; language?: string }) => void;
  setLogLevel: (level: LogLevel, opts?: { service?: ServiceName; force?: boolean }) => void;
  getLogLevel: (service: ServiceName) => LogLevel;
  setCustomerTokenRefresher: (refresher: CustomerTokenRefresher | null) => void;
}

export function createCore(config: EmporixConfig): EmporixCore;
```

`create-core.ts` imports only `core/*` (config, auth, http, logger, context) — **never** `./services/*`. It owns the logger/resolver setup, `tokenProvider`, `customerRefresh`, `requestContext`, and the `mk` closure.

### 2. Service channel + dependency metadata (static, on each service class)

The factory needs each service's logger/http **channel** (today hard-coded in `mk("product")`, `mk("customer-management")`, …) and its inter-service **deps**. Colocate that on each service class as static metadata:

```ts
export class ProductService {
  static readonly channel: ServiceName = "product";
  // no deps
}
export class CompaniesService {
  static readonly channel: ServiceName = "customer-management";
}
export class SegmentService {
  static readonly channel: ServiceName = "segment";
  /** Public-name deps that must be present + built first. */
  static readonly deps = ["products", "categories"] as const;
  constructor(ctx: ClientContext, deps: { products: ProductService; categories: CategoryService }) { … }
}
```

This is a mechanical +1–2 lines per service file and a nice colocation (each service declares its own channel instead of `client.ts` knowing it). `SegmentService` is the **only** service with deps today.

### 3. `create-emporix-client.ts` — the factory (no service imports)

```ts
type ServiceCtor = { channel: ServiceName; deps?: readonly string[]; new (ctx: ClientContext, deps?: any): object };

export function createEmporixClient<S extends Record<string, ServiceCtor>>(
  config: EmporixConfig,
  services: S,
): EmporixCore & { [K in keyof S]: InstanceType<S[K]> };
```

Behavior:
1. `const core = createCore(config)`.
2. Instantiate dep-free services first, then dependents (one topological pass; only `segments` has deps), each via `new Svc(core.mk(Svc.channel), resolvedDeps)`.
3. If a service declares `deps` and any is missing from `services`, throw a clear `EmporixError` (e.g. `createEmporixClient: "segments" requires "products" and "categories" in the services map`). A type-level constraint is attempted (conditional type requiring deps' presence); the runtime guard is the guarantee.
4. Return `{ ...core, ...builtServices }`, typed via the mapped `InstanceType` so `client.products` is a `ProductService`.

### 4. `client.ts` — `EmporixClient` re-implemented on `createCore`

`EmporixClient` keeps its current public shape and **still imports + instantiates all services** (unchanged behavior), but its constructor now delegates the infra half to `createCore(config)` and then does the same `new XService(core.mk(...))` calls it does today. This removes the duplicated infra code while keeping the class as the eager, batteries-included default. Importing `EmporixClient` still pulls everything in — by design.

## Tree-shaking — why it works and how it's verified

- `createCore` and `createEmporixClient` import zero services → referencing them adds nothing to the bundle.
- `EmporixClient` is in its own module that imports everything → only bundled if the consumer references it.
- Package is already `"sideEffects": false`, so bundlers drop unused barrel exports.
- **Verification:** a build-time bundle probe (added to the existing `check:dist`/scripts or a new script) bundles a fixture that imports only `createEmporixClient` + `ProductService` + `CartService` and asserts the output does **not** contain markers from unused services (e.g. `ReturnsService`, `WebhookService`, `ApprovalService`). This is the load-bearing proof that the factory tree-shakes; without it the win is unverifiable.

## Error handling

- Missing-dep guard (above) throws `EmporixError` at factory call time.
- Everything else (auth, retries, typed HTTP errors) is inherited unchanged from `createCore`/`HttpClient`.

## Testing strategy

- **Behavior parity:** a new `tests/create-emporix-client.test.ts` builds a client via `createEmporixClient(config, { products: ProductService, carts: CartService })` and asserts it behaves identically to `new EmporixClient(config)` for those services (same MSW round-trips, same auth, `client.products.get` works, `setStorefrontContext` works).
- **Dep wiring:** `createEmporixClient(config, { segments, products, categories })` wires segments' product/category deps; omitting them throws the guard error.
- **`EmporixClient` regression net:** the entire existing SDK suite (628 tests) must stay green with **zero edits** — proves the `createCore` extraction didn't change the class's behavior.
- **Tree-shaking probe** (above) green.
- `pnpm -r build && pnpm typecheck` clean; examples still compile.

## Release

`@viu/emporix-sdk` **minor** — additive API (`createEmporixClient`, `createCore`, exported service classes already public), no breaking change. One changeset. New exports added to `index.ts`. (Service classes are already exported for typing; the factory consumes the same public classes.)

## Branch & PR

Branch `feat/create-emporix-client-factory` (from `main`). Standalone PR, independent of the row-8 query-factory work. Sequencing note: purely additive, so it can land before or after row 8 without conflict (different packages).
