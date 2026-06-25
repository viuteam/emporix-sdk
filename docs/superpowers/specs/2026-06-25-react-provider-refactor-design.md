# Design: `packages/react` Provider Refactor

**Date:** 2026-06-25
**Status:** Approved (scope + approach)
**Branch:** `chore/component-refactor`

## Goal

Reduce lines-of-code and cognitive complexity *per file* for the two oversized
React components in `packages/react/src`, while preserving:

- external behavior (rendered output, effect timing, switch semantics),
- the public props API and package exports,
- TypeScript strictness (no `any`),
- the existing green test suite (59 files / 298 tests).

## Targets

| File | Before | Responsibilities (inline) |
|---|---|---|
| `provider.tsx` | 557 LOC | `EmporixProvider` (7) + `SiteContextProvider` (5) + `useEmporix` |
| `company-context.tsx` | 248 LOC | `CompanyContextProvider` (6) + `useActiveCompany` |

### Smells
- God-components: many unrelated responsibilities per file.
- Data/side-effect logic (telemetry subscriptions, auth refresh, site-DTO
  derivation, company bootstrap/switch) interleaved with rendering.
- Duplicated logic: `setSite` / `setCurrency` / `setLanguage` share ~90% of the
  same optimistic-flip → invalidate → `isSwitching` → `sessionContext.patch` →
  error-catch shape.
- ~100 LOC of types + JSDoc bloating the top of `provider.tsx`.
- Inline constant `DEFAULT_QUERY_OPTIONS`.

## Approach — A: extract custom hooks + co-locate types + split components

**Facade invariant (the safety key):** `provider.tsx` remains the module that
re-exports everything currently imported from it. The codebase has 40+ hooks
importing `useEmporix` from `../provider`, 3 hooks importing `EmporixSiteContext`
/ `SiteContextValue` from `../provider`, and `index.ts` re-exporting
`EmporixProviderProps` / `SiteContextValue` from `./provider`. By keeping those
names exported (re-exported from the new modules), **zero consumer imports
change** and the public API is bit-identical.

### New file structure

```
packages/react/src/
├── provider.tsx                 # facade: EmporixContext, useEmporix,
│                                #   EmporixProvider (composition only),
│                                #   re-exports of types + EmporixSiteContext
├── provider.types.ts            # EmporixContextValue, SiteContextValue,
│                                #   EmporixProviderProps (+ JSDoc)
├── site-context.tsx             # EmporixSiteContext + SiteContextProvider
│                                #   + runSwitch helper (de-dupes 3 setters)
├── company-context.tsx          # facade: EmporixCompanyContext,
│                                #   useActiveCompany, CompanyContextProvider
│                                #   (composition only)
├── company-context.types.ts     # CompanyMode, CompanyContextValue, NULL_CTX
└── hooks/internal/
    ├── use-emporix-query-defaults.ts   # ref-guarded setQueryDefaults
    ├── use-provider-wiring.ts          # anon-store attach + SSR token seed
    ├── use-telemetry-source.ts         # safeEmit + telemetryValue + subs effect
    ├── use-customer-token-refresher.ts # auto-refresh effect
    └── use-company-bootstrap.ts        # switchTo + load + effects + setActiveCompany
```

### Expected complexity reduction

| File | After (target) |
|---|---|
| `provider.tsx` | ~120 LOC (facade + composition) |
| `site-context.tsx` | ~150 LOC, de-duplicated setters |
| `company-context.tsx` | ~60 LOC (facade + composition) |
| each extracted hook | 25–110 LOC, single responsibility |

## Behavior-preservation contract

These must NOT change:

1. **Effect ordering.** `use-emporix-query-defaults` and `use-provider-wiring`
   run during render (ref-guarded), *before* children's first fetch effects —
   exactly as today. They must stay render-phase, not `useEffect`.
2. **Telemetry no-op when no `onTelemetry`.** Subscriptions only attach when a
   handler is provided; `safeEmit` stays try/catch-wrapped.
3. **Switch semantics.** Optimistic flip + `invalidateQueries(["emporix"])`
   happens synchronously before the awaited PATCH; `switchError` is set but
   optimistic state is NOT rolled back; `isSwitching` brackets the PATCH.
4. **Company switch serialization.** The `switchChain` ref ordering and the
   local-state-only fallback (no refresh token) are preserved verbatim.
5. **`activeRef` written in an effect** (not render) — concurrent-safe.

## Testing

- Green baseline established: `pnpm -F @viu/emporix-sdk-react test` → 59 files /
  298 tests pass.
- TDD discipline: extract one unit at a time, re-run the package test suite +
  `pnpm typecheck` after each step. No test edits expected — if any test
  imports a moved internal symbol, that's a regression signal, not an
  acceptable change.
- Examples typecheck against built `dist/`; rebuild react package before any
  example typecheck.

## Out of scope

- No change to hook behavior, query keys, storage adapters, or the SDK core.
- No new features. No public-API additions.
- `errors.tsx` (40 LOC) and all hooks under the 150-LOC guideline are left
  alone.
