# Runtime Currency Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the storefront-demo switch the active **currency** at runtime (next to the existing site switcher), choosing any currency the active site supports — backed by a clean SDK affordance, not a client rebuild.

**Architecture:** Add a thin SDK primitive `EmporixClient.setStorefrontContext({ currency })` that re-binds the anonymous price context (mutates the context the token provider reads + invalidates the anon session so the next login re-mints with the new currency — this covers the **pre-cart** guest case that `sessionContext.patch` cannot). Add a React `setCurrency` to the site context that calls it, clears the currency-bound guest cart, best-effort PATCHes an existing server session context, and invalidates queries. Finally surface a currency `<select>` in the demo, populated from the active site's `availableCurrencies`.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), React 19 + React-Query, Vitest + MSW, pnpm workspace.

---

## Discovery notes (verified against the code — read before starting)

- **The SDK already mutates the price context at runtime** via `client.sessionContext.patch({ siteCode?, currency?, targetLocation? })` (`PATCH /session-context/{tenant}/me/context`). `matchByContext` resolves prices against this server-side session context. `packages/react/src/provider.tsx` `setSite` **already** derives the site's `currency` and PATCHes it — so **switching site already switches currency to that site's default**.
- **The gap this plan fills:** (1) choosing a *non-default* currency among a site's `availableCurrencies`; (2) **pre-cart** correctness — `sessionContext.patch` returns `false` when no session context exists yet (it is created server-side only after a cart). Before a cart exists, the currency is the one bound at anonymous-login. To change it pre-cart you must re-bind the anon context and re-login. That is what `setStorefrontContext` adds.
- **The anon login binds context** in `packages/sdk/src/core/auth.ts` `fetchAnonymous`: it reads `sf.context` and sends `currency`/`siteCode`/`targetLocation` as query params. We add a runtime **override** in `DefaultTokenProvider` rather than mutating the (read-only) `client.config`.
- `Site` (`packages/sdk/src/services/site.ts`) has `currency: string` (default) **and** `availableCurrencies?: string[]` (supported set).
- **Naming clash to avoid:** `provider.tsx` already has a `currency` state whose setter is `setCurrency` (line ~317). Task 2 renames that setter to `setCurrencyState` (mirroring the existing `setSiteCodeState`) before adding the public `setCurrency` callback.
- Carts are currency-bound → switching currency must clear `cartId` (mirrors `setSite` which already does `storage.setCartId(null)`).

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/sdk/src/core/auth.ts` | `TokenProvider.setAnonymousContext?` + `DefaultTokenProvider` override impl | 1 |
| `packages/sdk/src/client.ts` | `EmporixClient.setStorefrontContext` delegating method | 1 |
| `packages/sdk/tests/token-provider-anon.test.ts` | test for override + forced re-login | 1 |
| `packages/react/src/provider.tsx` | rename `setCurrency`→`setCurrencyState`; add public `setCurrency` | 2 |
| `packages/react/tests/use-site-context.test.tsx` | test for `setCurrency` | 2 |
| `examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx` | currency `<select>` | 3 |
| `.changeset/currency-switcher.md` | release entry (sdk + react minor) | 4 |

---

## Task 1: SDK — `setStorefrontContext` re-bind primitive

**Files:**
- Modify: `packages/sdk/src/core/auth.ts` (the `TokenProvider` interface ~line 48; `DefaultTokenProvider`; `fetchAnonymous` ~line 310)
- Modify: `packages/sdk/src/client.ts` (add a method on `EmporixClient`)
- Test: `packages/sdk/tests/token-provider-anon.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/token-provider-anon.test.ts` (inside a new `describe`):

```ts
describe("DefaultTokenProvider.setAnonymousContext", () => {
  it("overrides the login currency and forces a fresh login", async () => {
    let url = "";
    server.use(
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
        url = request.url;
        loginHits += 1;
        return HttpResponse.json({
          access_token: `anon-${loginHits}`, token_type: "Bearer", expires_in: 3599,
          refresh_token: "rt", sessionId: "s",
        });
      }),
    );
    const ctxCfg = {
      ...cfg,
      credentials: { storefront: { clientId: "sf", context: { currency: "CHF", siteCode: "main" } } },
    };
    const p = new DefaultTokenProvider(ctxCfg as never);
    await p.getAnonymousToken();                  // login #1 (CHF)
    p.setAnonymousContext!({ currency: "USD" });  // override + invalidate
    await p.getAnonymousToken();                  // login #2 (USD)
    const u = new URL(url);
    expect(u.searchParams.get("currency")).toBe("USD");
    expect(u.searchParams.get("siteCode")).toBe("main"); // unrelated field preserved
    expect(loginHits).toBe(2);                    // invalidation forced a fresh login
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-sdk test token-provider-anon`
Expected: FAIL — `p.setAnonymousContext is not a function`.

- [ ] **Step 3: Add the interface member**

In `packages/sdk/src/core/auth.ts`, in the `TokenProvider` interface (after the `attachAnonymousStore?` member), add:

```ts
  /**
   * Override the storefront context (currency/site/country) used for the next
   * anonymous login, then invalidate the current anonymous session so it
   * re-mints with the new context. No-op for providers without anon support.
   */
  setAnonymousContext?(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
  }): void;
```

- [ ] **Step 4: Implement it on `DefaultTokenProvider`**

In `DefaultTokenProvider`, add a private field next to the other anon state:

```ts
  private contextOverride:
    | { currency?: string; siteCode?: string; targetLocation?: string }
    | undefined;
```

Add the method (near `invalidateAnonymous`):

```ts
  setAnonymousContext(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
  }): void {
    const base = this.contextOverride ?? this.cfg.credentials.storefront?.context ?? {};
    this.contextOverride = { ...base, ...ctx };
    this.invalidateAnonymous();
  }
```

In `fetchAnonymous`, change the context source from:

```ts
    const c = sf.context;
```

to:

```ts
    const c = this.contextOverride ?? sf.context;
```

- [ ] **Step 5: Add the `EmporixClient` method**

In `packages/sdk/src/client.ts`, add a public method on `EmporixClient` (e.g. directly after the constructor or near other public methods):

```ts
  /**
   * Re-binds the storefront price context (currency / siteCode / targetLocation)
   * for anonymous pricing and invalidates the current anonymous session, so the
   * next request re-mints a token bound to the new context. Use this to switch
   * currency at runtime. Carts are currency-bound — clear the cart after a
   * currency change (the React `setCurrency` does this for you).
   */
  setStorefrontContext(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
  }): void {
    this.tokenProvider.setAnonymousContext?.(ctx);
  }
```

- [ ] **Step 6: Run the test — verify it passes**

Run: `pnpm -F @viu/emporix-sdk test token-provider-anon`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm -F @viu/emporix-sdk typecheck
git add packages/sdk/src/core/auth.ts packages/sdk/src/client.ts packages/sdk/tests/token-provider-anon.test.ts
git commit -m "feat(sdk): add setStorefrontContext to re-bind the anonymous price context"
```

---

## Task 2: React — `setCurrency` on the site context

**Files:**
- Modify: `packages/react/src/provider.tsx` (`SiteContextValue` ~line 14; `currency` state setter rename; new `setCurrency`; `value` memo)
- Test: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-site-context.test.tsx`. This test builds its own client so it can spy on `setStorefrontContext`:

```ts
import { vi } from "vitest";

describe("useSiteContext — setCurrency", () => {
  it("re-binds the context, clears the cart, patches the session, updates currency", async () => {
    const client = makeClient();
    const storage = createMemoryStorage();
    storage.setCartId("old-cart");
    storage.setSiteCode("main");
    const spy = vi.spyOn(client, "setStorefrontContext");
    let patchBody: { currency?: string; siteCode?: string } | undefined;
    server.use(
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ currency: "CHF", siteCode: "main", metadata: { version: 7 } }),
      ),
      http.patch("https://api.emporix.io/session-context/acme/me/context", async ({ request }) => {
        patchBody = (await request.json()) as typeof patchBody;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient} initialSiteCode="main">
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.setCurrency("USD");
    });

    expect(spy).toHaveBeenCalledWith({ currency: "USD" });
    expect(storage.getCartId()).toBeNull();           // cart is currency-bound
    expect(patchBody?.currency).toBe("USD");           // existing session updated
    expect(result.current.currency).toBe("USD");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test use-site-context`
Expected: FAIL — `result.current.setCurrency is not a function`.

- [ ] **Step 3: Add `setCurrency` to the `SiteContextValue` type**

In `packages/react/src/provider.tsx`, in `interface SiteContextValue` (after `setSite`), add:

```ts
  /**
   * Switch the active currency at runtime. Re-binds the anonymous price context,
   * clears the (currency-bound) guest cart, and updates an existing server
   * session context. The chosen currency must be in the active site's
   * `availableCurrencies`.
   */
  setCurrency: (currency: string) => Promise<void>;
```

- [ ] **Step 4: Rename the `currency` state setter to avoid the clash**

In the provider component body, rename the `useState` setter from `setCurrency` to `setCurrencyState` at **all four** sites (mirroring the existing `setSiteCodeState`):

```ts
  const [currency, setCurrencyState] = useState<string | null>(null);
```
and the three call sites that currently call `setCurrency(...)` inside the mount-derivation effect and `setSite`:
```ts
        setCurrencyState(site.currency);     // mount-derivation effect
```
```ts
        setCurrencyState(null);              // setSite(null) branch
```
```ts
        setCurrencyState(nextCurrency);      // setSite success branch
```

- [ ] **Step 5: Implement the public `setCurrency` callback**

Add this `useCallback` in the provider, right after the `setSite` definition:

```ts
  const setCurrency = useCallback(
    async (next: string) => {
      // Carts are currency-bound — drop the guest cart so a fresh one is created.
      storage.setCartId(null);
      setCurrencyState(next);
      setSwitchError(null);
      // Re-bind the anonymous price context so guest pricing uses the new
      // currency even before a session/cart exists (sessionContext.patch can't).
      client.setStorefrontContext({ currency: next });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      setIsSwitching(true);
      try {
        const token = storage.getCustomerToken();
        const authCtx = token ? auth.customer(token) : auth.anonymous();
        // Update an existing server session context (no-op / returns false pre-cart).
        await client.sessionContext.patch(
          { currency: next, ...(siteCode ? { siteCode } : {}) },
          authCtx,
        );
      } catch (e) {
        setSwitchError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsSwitching(false);
      }
    },
    [client, storage, qc, siteCode],
  );
```

- [ ] **Step 6: Expose `setCurrency` in the context value**

In the `value` `useMemo`, add `setCurrency` to the object and to the dependency array:

```ts
  const value = useMemo<SiteContextValue>(
    () => ({
      siteCode,
      currency,
      targetLocation,
      setSite,
      setCurrency,
      isSwitching,
      switchError,
    }),
    [siteCode, currency, targetLocation, setSite, setCurrency, isSwitching, switchError],
  );
```

- [ ] **Step 7: Run the test — verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test use-site-context`
Expected: PASS.

- [ ] **Step 8: Build SDK + typecheck React, then commit**

```bash
pnpm -F @viu/emporix-sdk build           # React resolves the SDK from dist/ (new setStorefrontContext)
pnpm -F @viu/emporix-sdk-react typecheck
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): add setCurrency to the site context"
```

---

## Task 3: Demo — currency `<select>` in the switcher

**Files:**
- Modify: `examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx`

The component already renders the site `<select>`. Add a currency `<select>` beside it: options from the **active site's** `availableCurrencies` (fallback to the single active `currency`), value = `useSiteContext().currency`, `onChange` → `setCurrency`.

- [ ] **Step 1: Replace the component with site + currency selects**

Write `examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx` as:

```tsx
import { useSites, useSiteContext } from "@viu/emporix-sdk-react";

const selectStyle = {
  width: "auto",
  border: "none",
  padding: "0.2em 0.3em",
  fontSize: "var(--step--2)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  background: "transparent",
};

export function SiteCurrencySwitcher() {
  const { siteCode, currency, setSite, setCurrency } = useSiteContext();
  const { data: sites } = useSites();

  const activeSite = sites?.find((s) => s.code === siteCode);
  // Currencies the active site supports; fall back to just the active currency.
  const currencies =
    activeSite?.availableCurrencies && activeSite.availableCurrencies.length > 0
      ? activeSite.availableCurrencies
      : currency
        ? [currency]
        : [];

  const showSites = !!sites && sites.length > 1;
  const showCurrencies = currencies.length > 1;
  if (!showSites && !showCurrencies) return null;

  return (
    <div className="cluster" style={{ gap: "var(--s-1)", alignItems: "center" }}>
      {showSites ? (
        <select
          aria-label="Site"
          value={siteCode ?? ""}
          onChange={(e) => void setSite(e.target.value || null)}
          className="field__control"
          style={selectStyle}
        >
          {sites!.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
      {showCurrencies ? (
        <select
          aria-label="Currency"
          value={currency ?? ""}
          onChange={(e) => void setCurrency(e.target.value)}
          className="field__control"
          style={selectStyle}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Build the demo — verify it compiles**

Run: `pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-examples-storefront-demo typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/src/app/SiteCurrencySwitcher.tsx
git commit -m "feat(examples): add a runtime currency switcher to the storefront-demo"
```

---

## Task 4: Changeset, full verify, finish

- [ ] **Step 1: Changeset**

Write `.changeset/currency-switcher.md`:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat: runtime currency switching

Adds `EmporixClient.setStorefrontContext({ currency, siteCode, targetLocation })`
to re-bind the anonymous price context at runtime (invalidating the anon session
so the next login re-mints with the new currency — covers the pre-cart guest
case `sessionContext.patch` cannot). Adds `useSiteContext().setCurrency(code)`,
which re-binds the context, clears the currency-bound guest cart, and PATCHes an
existing server session context. The storefront-demo gains a currency dropdown
populated from the active site's `availableCurrencies`.
```

- [ ] **Step 2: Full verify**

```bash
pnpm -r --filter "./packages/*" build
pnpm -r typecheck
pnpm -r test
```
Expected: all pass (SDK + React suites green; examples typecheck against the freshly built dist).

- [ ] **Step 3: Live verify (manual, optional)**

With a tenant whose site declares >1 `availableCurrencies`, run `pnpm -F @viu/emporix-examples-storefront-demo dev`, switch currency in the header, and confirm prices re-render in the new currency. If no multi-currency site is available, note it as deferred and rely on the unit tests.

- [ ] **Step 4: Commit any remaining + finish**

```bash
git add .changeset/currency-switcher.md
git commit -m "chore(release): add currency-switcher changeset"
```

**REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch`. Branch `feat/demo-currency-switcher` (off `main`).

---

## Self-Review

- **Spec coverage:** SDK re-bind primitive (T1), React `setCurrency` incl. cart clear + session PATCH (T2), demo dropdown from `availableCurrencies` (T3), changeset + verify + finish (T4). The "robust SDK affordance" choice is honoured — no client rebuild, no storage-poke.
- **Pre-cart correctness:** `setStorefrontContext` re-binds the anon session so guest pricing changes currency even before a cart exists; `sessionContext.patch` covers the post-cart / logged-in case. Both are wired in `setCurrency`.
- **Naming consistency:** the `useState` setter is renamed `setCurrencyState` (Step 2.4) before the public `setCurrency` (Step 2.5) is added — no shadowing. `setStorefrontContext` is the single name used in SDK (T1), React (T2), and the spy assertion (T2 test).
- **Cart semantics:** currency is cart-bound → `storage.setCartId(null)` on switch (mirrors `setSite`). Documented in the changeset.
- **Placeholder scan:** every code/command step is concrete; no TBDs.
