# Language Switch — Design Spec

**Date:** 2026-06-08
**Status:** Approved (brainstorming) → ready for implementation plan
**Packages:** `@viu/emporix-sdk`, `@viu/emporix-sdk-react`, `@viu/emporix-examples-storefront-demo`

## Overview

Add a runtime **language switch** so a storefront can change which language the
Emporix **data texts** (product / category names and descriptions) render in. The
active language is treated exactly like `currency` / `siteCode`: a storefront
context value that travels to the API as an `Accept-Language` header on every
read. The design is symmetric to the existing `setCurrency` flow.

**In scope:** Emporix-localized data fields (product / category names and
descriptions, and product-name maps embedded in carts / shopping lists / orders).

**Out of scope:**
- Static UI chrome (button/label strings like "Add to cart") — that needs a
  separate i18n dictionary layer and is a storefront concern, not the library's.
- Write paths (`Content-Language` for localized request bodies) — this feature is
  display/read only.

## Goals

- `client.setStorefrontContext({ language })` (SDK) sets an `Accept-Language`
  header applied to all requests.
- `useSiteContext()` exposes `language: string | null` + `setLanguage(lang)` (React),
  modeled after `setCurrency`.
- Switching language refetches localized reads with the new header; `language`
  becomes part of the React-Query keys of localized reads so the cache never
  serves stale-language strings.
- The choice persists across reloads (storage key `emporix.language`) and is
  mirrored into the server session context.
- A `LanguageSwitcher` in `storefront-demo` makes the switch visibly work.

## Current state (verified)

- **SDK:** `SessionContext` / `SessionContextPatch` already carry `language?: string`
  (`packages/sdk/src/services/session-context.ts:18,39`). `Site` DTO exposes
  `defaultLanguage: string` + `languages: string[]` (`site.ts:16-17`). The HTTP
  core (`core/http.ts`) does **not** send `Accept-Language` automatically;
  `client.setStorefrontContext` (`client.ts:230`) accepts only
  `currency / siteCode / targetLocation`.
- **React:** `SiteContextValue` (`provider.tsx`) has `siteCode`, `currency`,
  `targetLocation`, `setSite`, `setCurrency`, `isSwitching`, `switchError` — **no**
  `language` / `setLanguage`. `query-keys.ts:12` already anticipates a future
  `language` key dimension.
- **Examples:** localized text is rendered via `localized()` / `pickText` in
  `storefront-demo/src/lib/adapters.ts:9-31` with a **hard-coded**
  `LOCALE_ORDER = ["en", "en-US", "de", "de-CH", "de-DE"]` — no runtime language
  input. The only switcher today is `SiteCurrencySwitcher.tsx` (site + currency).

## Approach decision

**Accept-Language header (server-side resolution)** was chosen over client-side
picking from `{locale: value}` maps. Rationale: it follows the repo's established
`setCurrency` pattern, keeps consumer code simple (`product.name` is a string,
not a map to pick from), produces smaller payloads, is SSR-friendly, and is the
Emporix-intended / industry-standard content-negotiation mechanism. The only cost
— a refetch on switch plus a `language` query-key dimension — is acceptable for a
rarely-used control.

## Data flow

```
LanguageSwitcher (example UI)
        │  setLanguage("de")
        ▼
useSiteContext()  ── SiteContextValue: { …, language, setLanguage }
        ├─ 1. storage.setLanguage("de")                  (persists, survives reload)
        ├─ 2. client.setStorefrontContext({ language })  (header source, incl. anon/pre-cart)
        ├─ 3. qc.invalidateQueries(["emporix"])          (refetch with new header)
        └─ 4. client.sessionContext.patch({ language })  (best-effort, no-op pre-cart)
        ▼
SDK HttpClient  ── injects  Accept-Language: de  on every request
        ▼
Emporix API  ── returns  product.name = "…" (string in DE, server fallback to default)
        ▼
React-Query cache  ── key contains `language` ⇒ no cross-language collision
        ▼
Storefront renders pickText(name) → string  (LOCALE_ORDER now only a fallback)
```

**Deliberate differences from `setCurrency`:**
1. **No cart clearing** — language does not affect cart pricing.
2. **No token re-mint** — language is only a request header, not a pricing context
   (currency/site re-mint the anonymous token; language does not).
3. **`language` joins the query keys** of localized reads (otherwise the cache
   serves stale strings after a switch).
4. **Default comes from the site DTO** (`Site.defaultLanguage`); the selectable
   list from `Site.languages` (analogous to `availableCurrencies`).

## SDK changes (`@viu/emporix-sdk`)

### Shared request-context object (`client.ts`)

One object created once in the constructor, shared **by reference** with every
`HttpClient` instance (each service has its own via `mk(service)`):

```ts
private readonly requestContext: { language?: string };
// init: { language: cfg.credentials?.storefront?.ctx?.language }  (if present, else undefined)
```

Passed into each `mk(service)` → `new HttpClient({ …, requestContext })`. A
mutation to the shared object takes effect immediately across all services.

### Extend `setStorefrontContext` (`client.ts:230`)

```ts
setStorefrontContext(ctx: {
  currency?: string;
  siteCode?: string;
  targetLocation?: string;
  language?: string;          // ← new
}): void {
  if (ctx.language !== undefined) this.requestContext.language = ctx.language || undefined;
  const { language: _lang, ...priceCtx } = ctx;
  // Only currency/site/target re-mint the anonymous token; a language-only
  // change must NOT, so skip when no pricing field was passed.
  if (Object.keys(priceCtx).length > 0) this.tokenProvider.setAnonymousContext?.(priceCtx);
}
```

Language-only changes set `requestContext` and do **not** trigger a token re-mint.

### Header injection (`core/http.ts`)

`HttpClientOptions` gains `requestContext?: { language?: string }`. In `request()`,
`Accept-Language` is set as a **base** that per-request `headers` may override;
`Authorization` always wins:

```ts
headers: {
  ...(this.opts.requestContext?.language
    ? { "Accept-Language": this.opts.requestContext.language }
    : {}),
  ...(o.headers ?? {}),                 // per-request override (e.g. a service that wants "*")
  Authorization: `Bearer ${token}`,
  ...(o.body !== undefined && !isFormData ? { "Content-Type": "application/json" } : {}),
}
```

The header is sent on all requests; non-localized endpoints ignore it server-side
(harmless).

### SessionContext

No change — `SessionContextPatch.language` already exists.

## React changes (`@viu/emporix-sdk-react`)

### `SiteContextValue` (`provider.tsx`)

```ts
export interface SiteContextValue {
  siteCode: string | null;
  currency: string | null;
  targetLocation: string | null;
  language: string | null;                            // ← new
  setSite: (code: string | null) => Promise<void>;
  setCurrency: (currency: string) => Promise<void>;
  setLanguage: (language: string) => Promise<void>;   // ← new
  isSwitching: boolean;
  switchError: Error | null;
}
```

### `setLanguage` (modeled after `setCurrency`, no cart clearing)

```ts
const setLanguage = useCallback(async (next: string) => {
  storage.setLanguage(next);
  setLanguageState(next);
  setSwitchError(null);
  client.setStorefrontContext({ language: next });   // header source, incl. anon/pre-cart
  void qc.invalidateQueries({ queryKey: ["emporix"] });
  setIsSwitching(true);
  try {
    const token = storage.getCustomerToken();
    const authCtx = token ? auth.customer(token) : auth.anonymous();
    await client.sessionContext.patch({ language: next, ...(siteCode ? { siteCode } : {}) }, authCtx);
  } catch (e) {
    setSwitchError(e instanceof Error ? e : new Error(String(e)));
  } finally {
    setIsSwitching(false);
  }
}, [client, storage, qc, siteCode]);
```

### Initial state, mount-derive, site-switch (`SiteContextProvider`)

- `language` init: `initialLanguage` prop → `storage.getLanguage()` → `null`.
- Mount-derive effect (already fetches the site DTO for currency/targetLocation):
  if `language === null`, seed from `site.defaultLanguage` **and** call
  `client.setStorefrontContext({ language })` so the first read carries the header.
- In `setSite`: after loading the new site DTO, if the active language is not in
  `site.languages`, reset to `site.defaultLanguage` (set state + `setStorefrontContext`
  + include in the session-context PATCH).

### Query keys — localized reads only

`language` is read from `useSiteContext()` and appended to the keys of read hooks
whose responses contain localized text. Central change in
`hooks/internal/query-keys.ts` (the factory) plus the consuming hooks. Mutations
are untouched.

**Include (localized):**

| Hook | Reason |
|---|---|
| `use-products` | product name/description |
| `use-categories` | category name + embedded products (`productsIn`) |
| `use-variant-children` | variant names |
| `use-my-segments` | segments return products & categories |
| `use-cart` | line items carry product-name maps |
| `use-shopping-lists` | items carry product-name maps |
| `use-my-orders` / `use-my-orders-infinite` / `use-order` | order line items carry product-name maps |
| `use-sales-order` | same as orders |

**Exclude (no language-varying text, unchanged):** `use-match-prices(-chunked)`,
`use-availabilit*`, `use-sites` (plain-string `name`), `use-product-media`
(url/type), `use-returns`, `use-reward-points`, `use-coupons` (mutations),
`use-customer-*`, `use-compan*`, `use-company-contacts/-locations/-groups`,
`use-approvals`.

### Storage (`storage/index.ts` + `cookie.ts` / `local-storage.ts` / `memory.ts`)

`EmporixStorage` gains `getLanguage(): string | null` / `setLanguage(v: string | null): void`;
storage key `emporix.language`. Implemented in all three adapters, symmetric to
the existing `getSiteCode` / `setSiteCode`.

### Provider props (`provider.tsx`)

`EmporixProviderProps.initialLanguage?: string` (analogous to `initialSiteCode`),
forwarded to `SiteContextProvider`.

## Example UI (`storefront-demo`)

### `LanguageSwitcher.tsx` (analogous to `SiteCurrencySwitcher.tsx`)

```tsx
import { useSites, useSiteContext } from "@viu/emporix-sdk-react";

export function LanguageSwitcher() {
  const { siteCode, language, setLanguage } = useSiteContext();
  const { data: sites } = useSites();
  const activeSite = sites?.find((s) => s.code === siteCode);
  const languages = activeSite?.languages ?? (language ? [language] : []);
  if (languages.length <= 1) return null;            // only show when ≥2 languages
  return (
    <select aria-label="Language" value={language ?? ""}
            onChange={(e) => void setLanguage(e.target.value)} /* selectStyle */>
      {languages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
    </select>
  );
}
```

- Mounted in `app/Header.tsx` next to `<SiteCurrencySwitcher />`.
- `adapters.ts`: with Accept-Language the API returns **strings**, so `pickText`
  returns them directly. `localized()` / `LOCALE_ORDER` stay as a fallback (in case
  an endpoint still returns a map) — no rewrite, just devalued. The active-language
  re-sort of `LOCALE_ORDER` is intentionally skipped (YAGNI for strings).
- `App.tsx`: no client rebuild needed (unlike currency) — `setLanguage` sets the
  header at runtime via `setStorefrontContext`, and persistence runs through the
  `createLocalStorageStorage` adapter (`emporix.language`). Forwarding
  `initialLanguage` from DemoConfig is optional.

## Testing

**SDK (Vitest + MSW):**
- `HttpClient` injects `Accept-Language` from `requestContext`; per-request
  `headers` override it; no language ⇒ no header.
- `setStorefrontContext({ language })` sets the header **without** a token re-mint
  (currency/site still re-mint).
- `sessionContext.patch({ language })` sends the field (body assertion).

**React (Vitest + jsdom + MSW):**
- `useSiteContext()` exposes `language` + `setLanguage`.
- `setLanguage("de")` → state + `storage.getLanguage()` updated,
  `setStorefrontContext` called, `invalidateQueries(["emporix"])`, session-context
  PATCH (best-effort, no-op pre-cart).
- Initial resolution: prop → storage → site default (mount-derive).
- Site switch: language not in `newSite.languages` → reset to `newSite.defaultLanguage`.
- A localized hook's query key contains `language` (e.g. `useProducts`) — two
  languages ⇒ two cache entries.
- Storage adapters (memory / local-storage / cookie): `get/setLanguage` round-trip.

## Out of scope / follow-ups

- Static UI-string i18n (dictionary / framework) — separate feature.
- `Content-Language` on localized write paths.
- Docs (`docs/react.md` i18n section) and an e2e language-switch spec — not in this
  deliverable (library + example UI only); can follow.
