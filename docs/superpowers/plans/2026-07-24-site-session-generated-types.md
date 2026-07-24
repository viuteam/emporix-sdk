# site & session-context on generated types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Derive the public types of `SiteService` and `SessionContextService` from the generated `site-settings-service` / `session-context` types, preserving the curated guarantees (required `active`/`default`/`sessionId`, ergonomic flat-`version` patch). Types-only; runtime unchanged.

**Architecture:** Two new `*-types.ts` files import the generated schemas and derive the public types; the services re-export from them instead of declaring inline interfaces.

**Tech Stack:** TypeScript, Vitest (`expectTypeOf` for type-level tests).

## Global Constraints

- Branch `feat/site-session-generated-types`, off `chore/register-missing-api-specs` (PR #155). Do not rebase onto main until #155 merges.
- Runtime behavior MUST NOT change — existing `site.test.ts` / `session-context.test.ts` stay green untouched.
- Preserve the exact public names: `Site`, `SessionContext`, `SessionContextPatch` (re-exported from the service module).
- Verify per task: `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run <files>`.
- Commit scope `sdk` (code) / `docs` (docs). First word after scope is a lowercase verb.

---

## Task 1: Site on generated types

**Files:**
- Create: `packages/sdk/src/services/site-types.ts`
- Modify: `packages/sdk/src/services/site.ts`
- Test: `packages/sdk/tests/services/site-types.test.ts`

- [ ] **Step 1: Create `site-types.ts`**

```ts
import type { SiteDto, AddressDto, HomeBaseDto } from "../generated/site-settings-service";

/** A site's home-base address (generated `AddressDto`). */
export type SiteAddress = AddressDto;
/** A site's home base — address + optional geo/timezone (generated `HomeBaseDto`). */
export type SiteHomeBase = HomeBaseDto;

/**
 * A site as returned by the Site Settings Service. Mirrors the generated
 * `SiteDto`, but re-tightens `active`/`default` to required — the storefront
 * relies on both being present (see {@link SiteService.current}).
 */
export type Site = Omit<SiteDto, "active" | "default"> & {
  active: boolean;
  default: boolean;
};
```

- [ ] **Step 2: Refactor `site.ts`** — replace the inline `interface Site { … }` (lines 6–33) with an import + re-export. New top of file:

```ts
import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type { Site } from "./site-types";

export type { Site, SiteAddress, SiteHomeBase } from "./site-types";

const ANON: AuthContext = auth.anonymous();
```

Leave the `SiteService` class (methods `list`/`get`/`current`) exactly as-is.

- [ ] **Step 3: Write `site-types.test.ts`**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Site, SiteAddress, SiteHomeBase } from "../../src/services/site-types";

describe("site types", () => {
  it("derives from the generated SiteDto but keeps active/default required", () => {
    expectTypeOf<Site>().not.toBeNever();
    expectTypeOf<Site["active"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Site["default"]>().toEqualTypeOf<boolean>();
    // inherited from the generated SiteDto (proves derivation)
    expectTypeOf<Site["taxDeterminationBasedOn"]>().toEqualTypeOf<
      "BILLING_ADDRESS" | "SHIPPING_ADDRESS"
    >();
    expectTypeOf<SiteAddress>().not.toBeNever();
    expectTypeOf<SiteHomeBase>().not.toBeNever();
  });
});
```

- [ ] **Step 4: Verify** — `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/site.test.ts tests/services/site-types.test.ts`
Expected: typecheck clean; both files pass (existing site.test.ts unchanged & green).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/site-types.ts packages/sdk/src/services/site.ts packages/sdk/tests/services/site-types.test.ts
git commit -m "refactor(sdk): derive site types from generated site-settings-service"
```

---

## Task 2: Session-context on generated types

**Files:**
- Create: `packages/sdk/src/services/session-context-types.ts`
- Modify: `packages/sdk/src/services/session-context.ts`
- Test: `packages/sdk/tests/services/session-context-types.test.ts`

- [ ] **Step 1: Create `session-context-types.ts`**

```ts
import type {
  SessionContextGet,
  SessionContextPatch as GenSessionContextPatch,
  Context,
} from "../generated/session-context";

/** Custom session-context attributes — a nested key → (key → value) map. */
export type SessionContextData = Context;

/**
 * The current session context (`GET /me/context`). Mirrors the generated
 * `SessionContextGet` but re-tightens `sessionId` to required — a returned
 * context always carries one.
 */
export type SessionContext = Omit<SessionContextGet, "sessionId"> & {
  sessionId: string;
};

/**
 * Input for {@link SessionContextService.patch}. The updatable fields are
 * derived from the generated patch body; `version` is a flat convenience for
 * the wire's `metadata.version` (the service maps it). Omit `version` to have
 * the service resolve it via a GET first.
 */
export type SessionContextPatch = Pick<
  GenSessionContextPatch,
  "siteCode" | "currency" | "targetLocation" | "language" | "context"
> & {
  /** Optimistic-locking version. If omitted, resolved via GET. */
  version?: number;
};
```

- [ ] **Step 2: Refactor `session-context.ts`** — remove the two inline interfaces (`SessionContext` lines 6–25 and `SessionContextPatch` lines 27–43); add import + re-export. New top of file:

```ts
import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type { SessionContext, SessionContextPatch } from "./session-context-types";

export type { SessionContext, SessionContextPatch, SessionContextData } from "./session-context-types";

const ANON: AuthContext = auth.anonymous();
```

Leave the `SessionContextService` class (`get`/`patch`) and the `isNotFound` helper exactly as-is. The `patch()` destructure `const { version: _v, ...fields } = input;` continues to work — `fields` is the derived updatable set.

- [ ] **Step 3: Write `session-context-types.test.ts`**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  SessionContext,
  SessionContextPatch,
  SessionContextData,
} from "../../src/services/session-context-types";

describe("session-context types", () => {
  it("keeps sessionId required and a flat version patch", () => {
    expectTypeOf<SessionContext>().not.toBeNever();
    expectTypeOf<SessionContext["sessionId"]>().toEqualTypeOf<string>();
    expectTypeOf<SessionContextData>().not.toBeNever();
    // flat convenience version, resolved to metadata.version by the service
    expectTypeOf<SessionContextPatch["version"]>().toEqualTypeOf<number | undefined>();
    // a bare patch (no metadata) is valid input
    expectTypeOf<{ siteCode: string }>().toMatchTypeOf<SessionContextPatch>();
  });
});
```

- [ ] **Step 4: Verify** — `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run tests/services/session-context.test.ts tests/services/session-context-types.test.ts`
Expected: typecheck clean; both files pass (existing session-context.test.ts unchanged & green).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/session-context-types.ts packages/sdk/src/services/session-context.ts packages/sdk/tests/services/session-context-types.test.ts
git commit -m "refactor(sdk): derive session-context types from generated types"
```

---

## Task 3: Changeset + full verification

**Files:**
- Create: `.changeset/site-session-generated-types.md`

- [ ] **Step 1: Create the changeset**

```markdown
---
"@viu/emporix-sdk": minor
---

Derive `SiteService` and `SessionContextService` public types from the
generated `site-settings-service` / `session-context` types. `Site` now
inherits every generated field (shipping/payment/tax/assistedBuying/mixins/
taxDeterminationBasedOn, richer address) while keeping `active`/`default`
required; `SessionContext.sessionId` stays required and the ergonomic flat
`patch({ …, version })` DX is unchanged. Note: `SessionContext.context` /
`SessionContextPatch.context` are now the accurate nested map type
(`Record<string, Record<string, unknown>>`) instead of `Record<string, unknown>`.
```

- [ ] **Step 2: Full package verification** — `cd packages/sdk && pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build`
Expected: typecheck clean, all tests pass, build writes `dist/`.

- [ ] **Step 3: Repo-wide typecheck** — `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build && pnpm typecheck`
Expected: clean (examples typecheck against the built dist).

- [ ] **Step 4: Commit**

```bash
git add .changeset/site-session-generated-types.md
git commit -m "docs(sdk): add changeset for site/session-context generated types"
```

## Self-Review

- **Spec coverage:** Task 1 = Site derivation + curation; Task 2 = session-context derivation + curation + flat-version preservation; Task 3 = changeset + verification. All spec sections covered.
- **Type consistency:** public names `Site` / `SessionContext` / `SessionContextPatch` preserved and re-exported; `SessionContextData` newly exported. `patch()` untouched — its destructure matches the derived `SessionContextPatch`.
- **No runtime change:** existing service tests run unmodified as the regression guard.
