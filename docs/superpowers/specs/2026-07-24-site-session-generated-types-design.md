# site & session-context on generated types (Design)

**Date:** 2026-07-24
**Status:** approved (design)
**Package:** `@viu/emporix-sdk`
**Depends on:** `chore/register-missing-api-specs` (PR #155) — the generated
`site-settings-service` and `session-context` types only exist on that branch.

## Goal

Refactor the two hand-written services `SiteService` and
`SessionContextService` so their public types are **derived from the newly
generated types** (`src/generated/site-settings-service`,
`src/generated/session-context`) instead of standalone hand-written interfaces.
Runtime behavior is unchanged; this is a types-only refactor.

## Approach: derived + curated (not a 1:1 alias)

The generated types become the source of truth for field **definitions**, but
the SDK keeps the deliberate curation the current public API provides:

1. **`Site.active` / `Site.default` stay required.** Generated `SiteDto` marks
   them optional; `SiteService.current()` relies on `default` being present.
2. **`SessionContext.sessionId` stays required.** Generated `SessionContextGet`
   marks it optional; a returned context always carries one.
3. **`SessionContextPatch` keeps the ergonomic flat `version`.** The wire body
   (`SessionContextPatch` generated) nests it under `metadata.version`; the
   service maps the flat field. The updatable field set is *derived* from the
   generated patch via `Pick`, so upstream field changes surface.

Everything else is inherited from the generated shapes — including fields the
hand-written types omitted (`SiteDto.shipping/payment/tax/assistedBuying/mixins/
taxDeterminationBasedOn`, the richer `AddressDto`) and the more accurate nested
`context` type.

## Types

### `packages/sdk/src/services/site-types.ts` (new)

```ts
import type { SiteDto, AddressDto, HomeBaseDto } from "../generated/site-settings-service";

export type SiteAddress = AddressDto;
export type SiteHomeBase = HomeBaseDto;
export type Site = Omit<SiteDto, "active" | "default"> & {
  active: boolean;
  default: boolean;
};
```

### `packages/sdk/src/services/session-context-types.ts` (new)

```ts
import type {
  SessionContextGet,
  SessionContextPatch as GenSessionContextPatch,
  Context,
} from "../generated/session-context";

export type SessionContextData = Context;
export type SessionContext = Omit<SessionContextGet, "sessionId"> & { sessionId: string };
export type SessionContextPatch = Pick<
  GenSessionContextPatch,
  "siteCode" | "currency" | "targetLocation" | "language" | "context"
> & { version?: number };
```

## Service changes

- `site.ts`: delete the inline `interface Site`; `import type { Site } from
  "./site-types"` and re-export `Site`, `SiteAddress`, `SiteHomeBase`. Methods
  unchanged.
- `session-context.ts`: delete the inline `interface SessionContext` /
  `interface SessionContextPatch`; import + re-export from
  `./session-context-types` (`SessionContext`, `SessionContextPatch`,
  `SessionContextData`). `patch()` logic unchanged — it still destructures the
  flat `version` and builds `metadata: { version }`.

## Public-API impact

- **Additive:** `Site` gains the generated fields it previously omitted;
  new `SiteAddress` / `SiteHomeBase` / `SessionContextData` exports.
- **Refinement (potentially breaking for a caller):** `SessionContext.context`
  and `SessionContextPatch.context` change from the loose
  `Record<string, unknown>` to the generated nested `Context`
  (`Record<string, Record<string, unknown>>`) — the accurate wire shape. A
  caller passing a flat/string-valued context would now see a type error.
- **Preserved:** `Site.active/default` and `SessionContext.sessionId` remain
  required; the flat `patch({ …, version })` DX is unchanged. Runtime behavior
  is identical.

Release: `@viu/emporix-sdk` **minor** (new fields/exports + the `context`
refinement).

## Testing

Runtime is unchanged, so the existing `site.test.ts` / `session-context.test.ts`
(MSW, mocked `http.request`) must stay green — they assert paths/logic, not the
public types. Add type-level tests (`expectTypeOf`, mirroring
`indexing-types.test.ts`) locking the curation:

- `site-types.test.ts`: `Site["active"]` and `Site["default"]` are `boolean`
  (not optional); `Site["taxDeterminationBasedOn"]` is inherited from the
  generated type (proves derivation).
- `session-context-types.test.ts`: `SessionContext["sessionId"]` is `string`;
  `SessionContextPatch["version"]` is `number | undefined` and the type has no
  required `metadata` (proves the flat-version curation).

## Out of scope

No endpoint/method changes; no React bindings; the OAuth / invoice / quote
services (also newly registered in #155) are not wrapped here.
