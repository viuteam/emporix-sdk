# `useActiveSite()` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `useActiveSite()` React hook returning the active site's DTO, and refactor the two demo switchers to use it (removing the duplicated `sites.find(code === siteCode)`).

**Architecture:** `useActiveSite()` composes the existing `useSiteContext()` (for `siteCode`) and `useSites()` (for the list) and returns `sites.find(s => s.code === siteCode)` — no new query/network. The demo `LanguageSwitcher` and `SiteCurrencySwitcher` drop their own `find` line.

**Tech Stack:** TypeScript, React + React-Query, Vitest + MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-09-use-active-site-design.md`.

---

## Task 1: `useActiveSite` hook + tests + exports

**Files:**
- Modify: `packages/react/src/hooks/use-sites.ts`
- Modify: `packages/react/src/hooks/index.ts` (line ~55)
- Modify: `packages/react/src/index.ts` (line ~53)
- Test: `packages/react/tests/use-active-site.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/use-active-site.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveSite, useSites } from "../src/hooks/use-sites";
import type { ReactNode } from "react";

const SITES = [
  { code: "main", name: "Main", active: true, default: true, defaultLanguage: "en",
    languages: ["en", "de"], currency: "EUR", availableCurrencies: ["EUR", "CHF"],
    homeBase: { address: { country: "DE", zipCode: "1" } }, shipToCountries: ["DE"] },
  { code: "ch", name: "CH", active: true, default: false, defaultLanguage: "de",
    languages: ["de"], currency: "CHF", availableCurrencies: ["CHF"],
    homeBase: { address: { country: "CH", zipCode: "1" } }, shipToCountries: ["CH"] },
];

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/site/acme/sites", () => HttpResponse.json(SITES)),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(initialSiteCode?: string) {
  const client = new EmporixClient({ tenant: "acme", credentials: { storefront: { clientId: "sf" } }, logger: false });
  const storage = createMemoryStorage();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={storage}
      queryClient={queryClient}
      {...(initialSiteCode !== undefined ? { initialSiteCode } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("useActiveSite", () => {
  it("returns the site whose code matches the active siteCode", async () => {
    const { result } = renderHook(() => useActiveSite(), { wrapper: wrap("ch") });
    await waitFor(() => expect(result.current?.code).toBe("ch"));
    expect(result.current?.currency).toBe("CHF");
  });

  it("returns undefined when the active code has no matching site", async () => {
    const { result } = renderHook(() => ({ active: useActiveSite(), sites: useSites() }), {
      wrapper: wrap("does-not-exist"),
    });
    await waitFor(() => expect(result.current.sites.isSuccess).toBe(true));
    expect(result.current.active).toBeUndefined();
  });

  it("returns undefined when there is no active siteCode", () => {
    const { result } = renderHook(() => useActiveSite(), { wrapper: wrap() });
    expect(result.current).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test use-active-site`
Expected: FAIL — `useActiveSite` is not exported from `../src/hooks/use-sites`.

- [ ] **Step 3: Add the hook**

In `packages/react/src/hooks/use-sites.ts`, add the import of `useSiteContext` at the top (next to the existing imports) and append the hook. The current imports are:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Site } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";
```

Add this import line:
```ts
import { useSiteContext } from "./use-site-context";
```

Append at the end of the file:
```ts
/**
 * The active site — the one whose `code` matches `useSiteContext().siteCode`.
 * Returns `undefined` while the sites list is loading, when no site is active,
 * or when the active code has no match. Derives from the shared `useSites()`
 * query (React-Query dedupes — no extra request).
 */
export function useActiveSite(options: QueryOpts = {}): Site | undefined {
  const { siteCode } = useSiteContext();
  const { data: sites } = useSites(options);
  return siteCode ? sites?.find((s) => s.code === siteCode) : undefined;
}
```

- [ ] **Step 4: Export it**

In `packages/react/src/hooks/index.ts`, change line ~55 from:
```ts
export { useSites, useDefaultSite } from "./use-sites";
```
to:
```ts
export { useSites, useDefaultSite, useActiveSite } from "./use-sites";
```

In `packages/react/src/index.ts`, add `useActiveSite` to the hook re-export list (next to `useSites`, `useDefaultSite` at line ~53):
```ts
  useSites,
  useDefaultSite,
  useActiveSite,
```

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test use-active-site`
Expected: PASS (3 cases).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm -F @viu/emporix-sdk-react typecheck
git add packages/react/src/hooks/use-sites.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-active-site.test.tsx
git commit -m "feat(react): add useActiveSite hook"
```

---

## Task 2: Refactor the demo switchers to use `useActiveSite`

**Files:**
- Modify: `examples/storefront-demo/src/app/LanguageSwitcher.tsx`
- Modify: `examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx`

- [ ] **Step 1: LanguageSwitcher — use the hook**

Change the import:
```ts
import { useSites, useSiteContext } from "@viu/emporix-sdk-react";
```
to:
```ts
import { useActiveSite, useSiteContext } from "@viu/emporix-sdk-react";
```

Change the top of the component from:
```ts
  const { siteCode, language, setLanguage } = useSiteContext();
  const { data: sites } = useSites();
  const activeSite = sites?.find((s) => s.code === siteCode);
```
to:
```ts
  const { language, setLanguage } = useSiteContext();
  const activeSite = useActiveSite();
```
(Drop `siteCode` from the destructure — it was only used for the `find`. The `languages` derivation and the rest of the component are unchanged.)

- [ ] **Step 2: SiteCurrencySwitcher — use the hook for the active site**

Change the import:
```ts
import { useSites, useSiteContext } from "@viu/emporix-sdk-react";
```
to:
```ts
import { useActiveSite, useSites, useSiteContext } from "@viu/emporix-sdk-react";
```

Change:
```ts
  const { data: sites } = useSites();

  const activeSite = sites?.find((s) => s.code === siteCode);
```
to:
```ts
  const { data: sites } = useSites();
  const activeSite = useActiveSite();
```
(Keep `useSites()` — it still renders the site-list dropdown; keep `siteCode` from `useSiteContext()` — it's used in the site `<select value={siteCode ?? ""}>`. React-Query dedupes the two `useSites` calls.)

- [ ] **Step 3: Build the React package, then typecheck the demo**

```bash
pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-storefront-demo typecheck
```
Expected: PASS (no unused-`siteCode`/`useSites` errors; the switchers compile against the new hook).

- [ ] **Step 4: Commit**

```bash
git add examples/storefront-demo/src/app/LanguageSwitcher.tsx examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx
git commit -m "refactor(examples): use useActiveSite in the demo switchers"
```

---

## Task 3: Changeset, full verify, finish

- [ ] **Step 1: Changeset**

Create `.changeset/use-active-site.md`:
```md
---
"@viu/emporix-sdk-react": minor
---

feat(react): add useActiveSite hook

`useActiveSite()` returns the active site's DTO (the one matching
`useSiteContext().siteCode`), derived from the shared `useSites()` query — so
consumers no longer re-implement `sites.find(s => s.code === siteCode)`.
```

- [ ] **Step 2: Full verify**

```bash
pnpm -r --filter "./packages/*" build
pnpm -r typecheck
pnpm -r test
```
Expected: all pass (React suite incl. the 3 new `useActiveSite` tests).

- [ ] **Step 3: Commit**

```bash
git add .changeset/use-active-site.md
git commit -m "chore(release): add useActiveSite changeset"
```

- [ ] **Step 4: Finish**

**REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch`. Branch `feat/use-active-site` (off `main`).

---

## Self-Review

- **Spec coverage:** hook (`Site | undefined`, derived from `useSites` + `useSiteContext`) + exports (T1); both demo switchers refactored (T2); changeset + verify + finish (T3). All spec sections covered.
- **Placeholder scan:** every step ships concrete code/commands.
- **Type consistency:** `useActiveSite(options?: QueryOpts): Site | undefined` is identical across the hook (T1 Step 3), the test (T1 Step 1), and the switcher usage (T2). `QueryOpts`/`Site`/`useSiteContext`/`useSites` are the existing exports. Drops `siteCode` in LanguageSwitcher (would otherwise be an unused-local error) but keeps it in SiteCurrencySwitcher (still used in the site select).
- **YAGNI:** no list-fallback helper, no by-code fetch, no changes to `useSites`/`useDefaultSite`/`useSiteContext` — matches the spec's out-of-scope.
