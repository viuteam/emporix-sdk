# React Provider Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the two oversized React components (`provider.tsx` 557 LOC, `company-context.tsx` 248 LOC) into focused custom hooks + co-located types, with no change to behavior, public API, or types.

**Architecture:** Extract side-effect/data logic into internal custom hooks; move types/constants to co-located files; lift `SiteContextProvider` and the company bootstrap into their own modules. `provider.tsx` and `company-context.tsx` stay as **facades** that re-export every symbol currently imported from them, so no consumer import changes.

**Tech Stack:** React 18, TypeScript strict, @tanstack/react-query v5, Vitest + MSW.

## Global Constraints (verbatim from spec)

- Public API bit-identical: `EmporixProvider`, `useEmporix`, type `EmporixProviderProps`, type `SiteContextValue` exported from `./provider`; `EmporixCompanyContext`, `CompanyContextProvider`, `useActiveCompany`, type `CompanyContextValue`, type `CompanyMode` from `./company-context`.
- `EmporixSiteContext` (const) and `SiteContextValue` (type) must remain importable from `../provider` (used by `use-site-context.ts`, `use-customer-session.ts`, `use-read-site.ts`).
- `useEmporix` must remain importable from `../provider` (40+ hook importers).
- Render-phase ref-guarded wiring (query-defaults, provider-wiring) stays render-phase, NOT `useEffect` — must precede children's first fetch.
- Telemetry no-op when no `onTelemetry`; `safeEmit` stays try/catch-wrapped.
- Switch semantics, company `switchChain` serialization, local-state-only fallback, `activeRef`-in-effect: preserved verbatim.
- No `any`. No test edits — green suite is the contract (baseline: 59 files / 298 tests).

**Per-task verification (every task ends with this):**
```bash
pnpm -F @viu/emporix-sdk-react test
pnpm -F @viu/emporix-sdk-react typecheck   # or: pnpm typecheck
```
Expected: `Test Files 59 passed (59)`, `Tests 298 passed (298)`, typecheck clean. Then commit. A red test or type error = stop and fix before committing.

---

### Task 1: Co-locate provider types

**Files:**
- Create: `packages/react/src/provider.types.ts`
- Modify: `packages/react/src/provider.tsx` (remove inline type decls, import + re-export)

**Interfaces:**
- Produces: `EmporixContextValue`, `SiteContextValue`, `EmporixProviderProps` (identical shapes + JSDoc moved verbatim from `provider.tsx:9-111`).

- [ ] **Step 1:** Create `provider.types.ts` containing `EmporixContextValue` (lines 9-12), `SiteContextValue` (14-50), `EmporixProviderProps` (67-111) moved verbatim, with imports: `import type { EmporixClient } from "@viu/emporix-sdk"; import type { EmporixStorage } from "./storage/index"; import type { EmporixTelemetryEvent } from "./telemetry"; import type { ReactNode } from "react";`.
- [ ] **Step 2:** In `provider.tsx` delete the moved decls; add `import type { EmporixContextValue, SiteContextValue, EmporixProviderProps } from "./provider.types";` and `export type { EmporixProviderProps, SiteContextValue } from "./provider.types";` (keeps `index.ts` re-export working).
- [ ] **Step 3:** Run per-task verification. Commit: `refactor(react): co-locate provider types in provider.types`

---

### Task 2: Extract query-defaults wiring hook

**Files:**
- Create: `packages/react/src/hooks/internal/use-emporix-query-defaults.ts`
- Modify: `packages/react/src/provider.tsx`

**Interfaces:**
- Produces: `useEmporixQueryDefaults(qc: QueryClient): void` — runs the ref-guarded `setQueryDefaults(["emporix"], …)` block (provider.tsx:142-158) during render. Owns `DEFAULT_QUERY_OPTIONS` (moved from provider.tsx:61-65).

- [ ] **Step 1:** Create the hook. Body = the existing `defaultsRef`/`if (defaultsRef.current !== qc)` block, with `DEFAULT_QUERY_OPTIONS` as a module const. Uses `useRef`. Keep all comments verbatim.
- [ ] **Step 2:** In `provider.tsx` replace the inline block + constant with `useEmporixQueryDefaults(qc);`.
- [ ] **Step 3:** Verify + commit: `refactor(react): extract use-emporix-query-defaults hook`

---

### Task 3: Extract SDK provider-wiring hook

**Files:**
- Create: `packages/react/src/hooks/internal/use-provider-wiring.ts`
- Modify: `packages/react/src/provider.tsx`

**Interfaces:**
- Produces: `useProviderWiring(args: { client: EmporixClient; storage: EmporixStorage; initialCustomerToken?: string; externalStorage?: EmporixStorage }): void` — the ref-guarded anon-store-attach + SSR-token-seed block (provider.tsx:166-176). `externalStorage` is the original `storage` prop (the seed only runs when a real storage prop was passed, matching `if (initialCustomerToken && storage && …)`).

- [ ] **Step 1:** Create hook with `wiredRef` ref-guard, comments verbatim. Seed condition uses `externalStorage` for the `storage &&` check, `args.storage` (resolved) for the attach.
- [ ] **Step 2:** In `provider.tsx` replace inline block with `useProviderWiring({ client, storage: value.storage, initialCustomerToken, externalStorage: storage });`.
- [ ] **Step 3:** Verify + commit: `refactor(react): extract use-provider-wiring hook`

---

### Task 4: Extract telemetry-source hook

**Files:**
- Create: `packages/react/src/hooks/internal/use-telemetry-source.ts`
- Modify: `packages/react/src/provider.tsx`

**Interfaces:**
- Produces: `useTelemetrySource(args: { qc: QueryClient; client: EmporixClient; storage: EmporixStorage; onTelemetry?: (e: EmporixTelemetryEvent) => void }): { emit: (e: EmporixTelemetryEvent) => void }` — owns `safeEmit` (useCallback), `telemetryValue` (useMemo), and the subscriptions `useEffect` (provider.tsx:180-279). Returns the memoized telemetry context value.

- [ ] **Step 1:** Create hook moving `safeEmit`, `telemetryValue`, and the subscriptions effect verbatim (all comments). Return `telemetryValue`.
- [ ] **Step 2:** In `provider.tsx`: `const telemetryValue = useTelemetrySource({ qc, client, storage: value.storage, onTelemetry });`. Keep `safeEmit` usage for Task 5 by having the hook also return `emit` (it does). Pass `telemetryValue.emit` where `safeEmit` was used in Task 5's effect — OR keep `safeEmit` available: have `useTelemetrySource` return `{ emit }` and `telemetryValue` both. Simpler: return the context value object `{ emit }` and use `telemetryValue` as both. (`telemetryValue` IS `{ emit: safeEmit }`.)
- [ ] **Step 3:** Verify + commit: `refactor(react): extract use-telemetry-source hook`

---

### Task 5: Extract customer-token-refresher hook

**Files:**
- Create: `packages/react/src/hooks/internal/use-customer-token-refresher.ts`
- Modify: `packages/react/src/provider.tsx`

**Interfaces:**
- Produces: `useCustomerTokenRefresher(args: { client: EmporixClient; storage: EmporixStorage; enabled?: boolean; emit: (e: EmporixTelemetryEvent) => void; onExpired?: () => void }): void` — the auto-refresh `useEffect` (provider.tsx:284-313) verbatim.

- [ ] **Step 1:** Create hook; `enabled` = `autoRefreshCustomerToken`, `emit` = telemetry emit, `onExpired` = `onCustomerSessionExpired`. Guard `if (!enabled) return;`.
- [ ] **Step 2:** In `provider.tsx`: `useCustomerTokenRefresher({ client, storage: value.storage, enabled: autoRefreshCustomerToken, emit: telemetryValue.emit, onExpired: onCustomerSessionExpired });`.
- [ ] **Step 3:** Verify + commit: `refactor(react): extract use-customer-token-refresher hook`

---

### Task 6: Lift SiteContextProvider into site-context.tsx + de-dupe setters

**Files:**
- Create: `packages/react/src/site-context.tsx`
- Modify: `packages/react/src/provider.tsx` (import `SiteContextProvider`, re-export `EmporixSiteContext`)

**Interfaces:**
- Produces: `EmporixSiteContext` (const, re-exported from `provider.tsx`), `SiteContextProvider` component (same props).
- New private helper inside the file:
  ```ts
  // De-dupes setSite/setCurrency/setLanguage: optimistic local change already
  // applied by caller; this runs the isSwitching-bracketed PATCH + error catch.
  async function runSwitch(
    patch: () => Promise<unknown>,
    setIsSwitching: (b: boolean) => void,
    setSwitchError: (e: Error | null) => void,
  ): Promise<void> {
    setIsSwitching(true);
    try { await patch(); }
    catch (e) { setSwitchError(e instanceof Error ? e : new Error(String(e))); }
    finally { setIsSwitching(false); }
  }
  ```
  Each setter keeps its own optimistic-flip + `invalidateQueries` (those differ per setter), then `await runSwitch(() => client.sessionContext.patch(…, authCtx), setIsSwitching, setSwitchError)`. `setSite`'s pre-PATCH derivation stays inline; only the try/catch/finally PATCH tail is funneled through `runSwitch`. **Behavior identical** — `switchError` set, no rollback, `isSwitching` bracketed.

- [ ] **Step 1:** Move `EmporixSiteContext` (line 53) + `SiteContextProvider` (345-550) into `site-context.tsx`. Imports: `auth`, `EmporixClient` from sdk; `SiteContextValue` from `./provider.types`; react hooks; `useQueryClient`. Add the `runSwitch` helper; refactor the three setters' tails to use it (keep each setter's unique pre-PATCH logic verbatim).
- [ ] **Step 2:** In `provider.tsx` delete `SiteContextProvider` + the `EmporixSiteContext` decl; add `import { SiteContextProvider, EmporixSiteContext } from "./site-context";` and `export { EmporixSiteContext } from "./site-context";` (keeps the 3 internal importers working).
- [ ] **Step 3:** Verify + commit: `refactor(react): lift SiteContextProvider into site-context module`

---

### Task 7: Confirm provider.tsx is a slim facade

**Files:**
- Modify: `packages/react/src/provider.tsx` (final tidy only)

- [ ] **Step 1:** Verify `provider.tsx` now = imports + re-exports + `EmporixContext` + `EmporixProvider` (storage memo, hook calls, render tree) + `useEmporix`. Target ≤ ~130 LOC. Remove now-unused imports (`useCallback`, `useEffect`, `useRef`, `useState`, `useQueryClient`, `auth` likely gone; keep `useMemo`, `useState` for fallbackQc, `QueryClient`/`QueryClientProvider`).
- [ ] **Step 2:** Verify (test + typecheck) + `pnpm -F @viu/emporix-sdk-react build`. Commit: `refactor(react): slim EmporixProvider to composition facade`

---

### Task 8: Co-locate company-context types

**Files:**
- Create: `packages/react/src/company-context.types.ts`
- Modify: `packages/react/src/company-context.tsx`

**Interfaces:**
- Produces: `CompanyMode`, `CompanyContextValue`, `NULL_CTX` (moved verbatim from company-context.tsx:16-52).

- [ ] **Step 1:** Create `company-context.types.ts` with `CompanyMode`, `CompanyContextValue`, `NULL_CTX`. Imports: `type { LegalEntity }` from sdk.
- [ ] **Step 2:** In `company-context.tsx` import them; `export type { CompanyContextValue, CompanyMode } from "./company-context.types";` (keeps `index.ts` re-export).
- [ ] **Step 3:** Verify + commit: `refactor(react): co-locate company-context types`

---

### Task 9: Extract company-bootstrap hook

**Files:**
- Create: `packages/react/src/hooks/internal/use-company-bootstrap.ts`
- Modify: `packages/react/src/company-context.tsx`

**Interfaces:**
- Produces: `useCompanyBootstrap(args: { client: EmporixClient; storage: EmporixStorage; initialActiveLegalEntityId?: string | null; emit: (e: EmporixTelemetryEvent) => void }): CompanyContextValue` — owns all state (`myCompanies`, `activeCompany`, `status`, `error`), `activeRef`, `switchChain`, `switchTo`, `load`, both effects, `setActiveCompany`, and the `value` useMemo (company-context.tsx:74-243). Returns the assembled `CompanyContextValue`.

- [ ] **Step 1:** Create the hook moving lines 74-243 verbatim (state, refs, `switchTo`, `load`, the two `useEffect`s, `setActiveCompany`, `value` memo). `emit` is passed in (was `const { emit } = useEmporixTelemetry();`). `qc` via `useQueryClient()` inside the hook. Return `value`.
- [ ] **Step 2:** In `company-context.tsx` `CompanyContextProvider` becomes: `const { emit } = useEmporixTelemetry(); const value = useCompanyBootstrap({ client, storage, initialActiveLegalEntityId, emit }); return <EmporixCompanyContext.Provider value={value}>{children}</EmporixCompanyContext.Provider>;`.
- [ ] **Step 3:** Verify + commit: `refactor(react): extract use-company-bootstrap hook`

---

### Task 10: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1:** `pnpm -F @viu/emporix-sdk-react test` → 298 pass.
- [ ] **Step 2:** `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` then `pnpm -F "@viu/emporix-examples-*" typecheck` (examples typecheck against dist).
- [ ] **Step 3:** `pnpm typecheck` repo-wide. Confirm final LOC: `wc -l packages/react/src/provider.tsx packages/react/src/site-context.tsx packages/react/src/company-context.tsx`.
- [ ] **Step 4:** `pnpm changeset` — patch bump for `@viu/emporix-sdk-react`, message: "internal refactor: split EmporixProvider/CompanyContext into focused hooks (no API change)". Commit.

---

## Self-Review

**Spec coverage:** Every spec file in the structure maps to a task — provider.types(T1), use-emporix-query-defaults(T2), use-provider-wiring(T3), use-telemetry-source(T4), use-customer-token-refresher(T5), site-context(T6), slim provider(T7), company-context.types(T8), use-company-bootstrap(T9), verify(T10). ✓

**Placeholder scan:** No TBD/TODO; each task names exact files, exact source line ranges to move, and the one genuinely-new helper (`runSwitch`) is shown in full. ✓

**Type consistency:** `SiteContextValue` consumed from `./provider.types` in both provider.tsx (re-export) and site-context.tsx (T1/T6). `emit` signature `(e: EmporixTelemetryEvent) => void` consistent across T4/T5/T9. `useEmporixQueryDefaults(qc)` / `useProviderWiring(...)` / `useTelemetrySource(...)` / `useCustomerTokenRefresher(...)` / `useCompanyBootstrap(...)` names match between Produces blocks and usage. ✓

**Behavior risk:** T4 returns `{ emit }` reused as both telemetry context value and the emit fn for T5 — `telemetryValue === { emit: safeEmit }`, identical to today. T6 `runSwitch` only wraps the try/catch/finally tail; per-setter optimistic logic stays inline → no semantic change.
