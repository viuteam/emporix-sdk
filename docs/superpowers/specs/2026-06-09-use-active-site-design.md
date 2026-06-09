# `useActiveSite()` — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorming) → ready for implementation plan
**Package:** `@viu/emporix-sdk-react`

## Overview

Add a `useActiveSite()` React hook that returns the **active** site's DTO — the one whose `code` matches `useSiteContext().siteCode`. Today consumers re-derive this with `sites?.find((s) => s.code === siteCode)`, duplicated in `SiteCurrencySwitcher` (for `availableCurrencies`) and `LanguageSwitcher` (for `languages`). The hook removes that duplication; both demo switchers are refactored to use it.

## Background (verified)

- No `useActiveSite` hook exists. The React package has `useSites()` (`Site[]`), `useDefaultSite()` (the `default: true` site — **not** the active one), and `useSiteContext()` (`{ siteCode, … }`).
- The `sites?.find((s) => s.code === siteCode)` pattern is duplicated in `examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx` and `.../LanguageSwitcher.tsx`, each followed by the same `activeSite?.X?.length ? X : fallback` list derivation.

## Goal

`const activeSite = useActiveSite();` → the active `Site | undefined`, sourced from the already-loaded `useSites()` list + the context `siteCode` (no extra request).

## Design

### Hook — `packages/react/src/hooks/use-sites.ts`

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

- Imports the existing `useSiteContext` (from `../provider`) and `useSites` (same file). `QueryOpts` is the existing options type (forwards `auth`).
- Exported from `packages/react/src/hooks/index.ts` and re-exported from `packages/react/src/index.ts` (alongside `useSites`/`useDefaultSite`).
- Must be used within `EmporixProvider` (same constraint as every hook; `useSiteContext`/`useSites` already throw otherwise).

### Demo refactor

**`LanguageSwitcher.tsx`** — drop the `useSites` import + the `find` line:
```ts
import { useActiveSite, useSiteContext } from "@viu/emporix-sdk-react";
const { language, setLanguage } = useSiteContext();
const activeSite = useActiveSite();
const languages = activeSite?.languages?.length ? activeSite.languages : language ? [language] : [];
```

**`SiteCurrencySwitcher.tsx`** — keep `useSites()` (it renders the site-list dropdown) but replace its own `find` line with `useActiveSite()` for `availableCurrencies`:
```ts
const { siteCode, currency, setSite, setCurrency } = useSiteContext();
const { data: sites } = useSites();
const activeSite = useActiveSite();
const currencies = activeSite?.availableCurrencies?.length ? activeSite.availableCurrencies : currency ? [currency] : [];
```
(The duplicate `useSites()` call — direct + inside `useActiveSite` — hits the same query key, so React-Query serves one fetch.)

## Data flow

`useActiveSite` → reads `siteCode` from the site context + `data` from the `useSites` query → returns `sites.find(code === siteCode)` (or `undefined`). No new network call; no new query key.

## Error handling

None new. Loading / no-active-site / no-match all collapse to `undefined`. Consumers already handle `undefined` (the switchers fall back to `[currency]`/`[language]` and self-hide on `length <= 1`).

## Testing (Vitest + MSW, `packages/react/tests/use-active-site.test.tsx`)

- Returns the site whose `code` matches the context `siteCode` (with `initialSiteCode`).
- Returns `undefined` when no site matches the active code.
- Returns `undefined` when there is no active `siteCode`.

## Out of scope (YAGNI)

- A generic "list-with-fallback" helper for the `?.X?.length ? X : fallback` derivation — stays demo-side (the fallback is view-specific).
- Fetching the active site by code (`client.sites.get`) — we derive from the shared `useSites()` list, matching the current code.
- Changing `useSites`/`useDefaultSite`/`useSiteContext`.

## File structure

| File | Change |
| --- | --- |
| `packages/react/src/hooks/use-sites.ts` | add `useActiveSite` |
| `packages/react/src/hooks/index.ts` | export `useActiveSite` |
| `packages/react/src/index.ts` | re-export `useActiveSite` |
| `packages/react/tests/use-active-site.test.tsx` | new tests |
| `examples/storefront-demo/src/app/LanguageSwitcher.tsx` | use the hook |
| `examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx` | use the hook |
| `.changeset/use-active-site.md` | `@viu/emporix-sdk-react` minor |

Commitlint: scope `react` (and `examples` for the demo refactor).
