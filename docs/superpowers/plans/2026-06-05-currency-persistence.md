# Currency Persistence (reload-safe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chosen currency survive a full page reload in the storefront-demo (today it reverts to the site default), without a client rebuild.

**Architecture:** Two coordinated changes. (1) React: the site-context `currency` state seeds from the client's configured `context.currency` (mirroring how `siteCode` already seeds from config/storage) so a config-bound currency drives the UI and the mount-time site-DTO derivation no longer overrides it. (2) Demo: persist the active currency into `DemoConfig` (localStorage) on every change via a tiny `CurrencyPersistor` effect — so on reload `buildClient` constructs the client with the persisted currency, the anonymous login binds it from the first request, and the UI seeds from it. No client rebuild, no on-mount re-login.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), React 19 + React-Query, Vitest + MSW, pnpm. Same branch: `feat/demo-currency-switcher`.

---

## Why this design (verified)

- The currency is bound to the **anonymous token at login** (`context.currency`). The demo builds the client from `DemoConfig` (`buildClient` reads `config.currency`). So persisting the choice into `DemoConfig` makes the reload bind the right currency **from the first request** — cleaner than reading an SDK storage slot and re-binding on mount (which would force an extra login + a CHF→EUR flash).
- Today the provider seeds `siteCode` from `storage`/`client.config…context.siteCode` (provider.tsx ~line 311-315) but seeds `currency` to `null` (line ~317) and derives it from the site DTO on mount (`if (!siteCode || currency !== null) return;`). Seeding `currency` from config makes the derivation skip (currency already non-null) → the user's choice is respected.
- Persisting on **every** currency change (not just explicit `setCurrency`) keeps `DemoConfig.currency` in sync with `setSite`-driven currency changes too, so a reload after a site switch is also consistent.
- The demo example has **no unit-test harness** (`"test": "echo …"`) → Task 2 is verified by typecheck + the live re-test in Task 3, not Vitest.

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/react/src/provider.tsx` | seed `currency` state from `client.config…context.currency` | 1 |
| `packages/react/tests/use-site-context.test.tsx` | test: config-seeded currency is respected (no site-DTO override) | 1 |
| `examples/storefront-demo/src/config/useDemoConfig.ts` | `persist(partial)` — localStorage write without setState | 2 |
| `examples/storefront-demo/src/config/ConfigGate.tsx` | expose `persist` via the render prop | 2 |
| `examples/storefront-demo/src/App.tsx` | wire `CurrencyPersistor` inside the provider | 2 |
| `.changeset/currency-switcher.md` | extend body to mention the seed behaviour | 3 |

---

## Task 1: React — seed `currency` from the client's configured context

**Files:**
- Modify: `packages/react/src/provider.tsx` (the `currency` `useState`, ~line 317)
- Test: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-site-context.test.tsx`:

```ts
describe("useSiteContext — currency seeding", () => {
  it("seeds currency from the client's configured context and does not override it from the site DTO", async () => {
    const client = new EmporixClient({
      tenant: "acme",
      credentials: {
        backend: { clientId: "b", secret: "s" },
        storefront: { clientId: "sf", context: { siteCode: "main", currency: "EUR" } },
      },
      logger: false,
    });
    const storage = createMemoryStorage();
    let siteFetched = false;
    server.use(
      http.get("https://api.emporix.io/site/acme/sites/main", () => {
        siteFetched = true;
        return HttpResponse.json({
          code: "main", name: "Main", active: true, default: true,
          defaultLanguage: "de", languages: ["de"],
          currency: "CHF", availableCurrencies: ["CHF", "EUR"],
          homeBase: { address: { country: "CH", zipCode: "8000" } },
          shipToCountries: ["CH"],
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient} initialSiteCode="main">
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: Wrapper });

    // Seeded synchronously from config — not null, not the site default (CHF).
    expect(result.current.currency).toBe("EUR");
    // Let mount effects flush; the derivation must skip (currency already set).
    await waitFor(() => expect(result.current.siteCode).toBe("main"));
    expect(result.current.currency).toBe("EUR");
    expect(siteFetched).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test use-site-context`
Expected: FAIL — `result.current.currency` is `null` (then derived to `"CHF"`), and `siteFetched` is `true`.

- [ ] **Step 3: Seed the `currency` state from config**

In `packages/react/src/provider.tsx`, change the `currency` state initializer from:

```ts
  const [currency, setCurrencyState] = useState<string | null>(null);
```

to:

```ts
  const [currency, setCurrencyState] = useState<string | null>(
    () => client.config?.credentials?.storefront?.context?.currency ?? null,
  );
```

(No other change — the existing mount-derivation guard `if (!siteCode || currency !== null) return;` now skips when a currency was seeded, and `setSite`/`setCurrency` still override it on an explicit switch.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test use-site-context`
Expected: PASS (the new test + all existing site-context tests, incl. "currency and targetLocation are null in MS-2" — that client has no `context.currency`, so it still seeds `null`).

- [ ] **Step 5: Build SDK is not needed (React-only source change). Typecheck + commit.**

```bash
pnpm -F @viu/emporix-sdk-react typecheck
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): seed site-context currency from the client config"
```

---

## Task 2: Demo — persist the active currency into DemoConfig

**Files:**
- Modify: `examples/storefront-demo/src/config/useDemoConfig.ts` (add `persist`)
- Modify: `examples/storefront-demo/src/config/ConfigGate.tsx` (render-prop signature)
- Modify: `examples/storefront-demo/src/App.tsx` (`CurrencyPersistor` + render prop)

- [ ] **Step 1: Add a `persist` updater to `useDemoConfig`**

In `examples/storefront-demo/src/config/useDemoConfig.ts`, change the hook to expose `persist` (writes localStorage only — no `setConfig`, so the client is NOT rebuilt; only the next reload sees it):

```ts
export function useDemoConfig() {
  const [config, setConfig] = useState<DemoConfig | null>(() => readConfig());
  const save = useCallback((c: DemoConfig) => {
    const n = normalizeConfig(c);
    writeConfig(n);
    setConfig(n);
  }, []);
  const reset = useCallback(() => {
    clearConfig();
    setConfig(null);
  }, []);
  // Persist a partial change WITHOUT triggering a client rebuild — used to
  // remember the active currency for the next reload.
  const persist = useCallback(
    (partial: Partial<DemoConfig>) => {
      if (config) writeConfig({ ...config, ...partial });
    },
    [config],
  );
  return { config, save, reset, persist };
}
```

- [ ] **Step 2: Expose `persist` through `ConfigGate`'s render prop**

Rewrite `examples/storefront-demo/src/config/ConfigGate.tsx`:

```tsx
import type { ReactNode } from "react";
import { useDemoConfig, type DemoConfig } from "./useDemoConfig";
import { SetupScreen } from "./SetupScreen";

export function ConfigGate({
  children,
}: {
  children: (
    config: DemoConfig,
    reset: () => void,
    persist: (partial: Partial<DemoConfig>) => void,
  ) => ReactNode;
}) {
  const { config, save, reset, persist } = useDemoConfig();
  if (!config) return <SetupScreen onSubmit={save} />;
  return <>{children(config, reset, persist)}</>;
}
```

- [ ] **Step 3: Add `CurrencyPersistor` and wire it in `App.tsx`**

In `examples/storefront-demo/src/App.tsx`:

Add the imports (top of file, with the other React / hook imports):

```ts
import { useEffect, useMemo, useRef } from "react";
import { EmporixProvider, createLocalStorageStorage, useSiteContext } from "@viu/emporix-sdk-react";
```
(Adjust the existing `import { useMemo } from "react"` line to include `useEffect, useRef`, and add `useSiteContext` to the existing `@viu/emporix-sdk-react` import — do not duplicate the import lines.)

Add the component (above `DemoApp`):

```tsx
/**
 * Persists the active currency into DemoConfig (localStorage) whenever it
 * changes, so a full page reload rebuilds the client with that currency. Must
 * render inside EmporixProvider (uses the site context). Renders nothing.
 */
function CurrencyPersistor({ onPersist }: { onPersist: (currency: string) => void }) {
  const { currency } = useSiteContext();
  const ref = useRef(onPersist);
  ref.current = onPersist;
  useEffect(() => {
    if (currency) ref.current(currency);
  }, [currency]);
  return null;
}
```

Change `DemoApp` to accept `persistCurrency` and render the persistor inside the provider:

```tsx
function DemoApp({
  config,
  reset,
  persistCurrency,
}: {
  config: DemoConfig;
  reset: () => void;
  persistCurrency: (currency: string) => void;
}) {
  const client = useMemo(() => buildClient(config), [config]);
  const storage = useMemo(() => createLocalStorageStorage(), []);

  return (
    <EmporixProvider
      client={client}
      storage={storage}
      autoRefreshCustomerToken
      onTelemetry={pushTelemetry}
      {...(config.siteCode ? { initialSiteCode: config.siteCode } : {})}
    >
      <CurrencyPersistor onPersist={persistCurrency} />
      <ToastProvider>
        {/* …existing BrowserRouter / AppShell / routes unchanged… */}
      </ToastProvider>
    </EmporixProvider>
  );
}
```
(Leave the existing `<ToastProvider>…</ToastProvider>` subtree exactly as-is; only add the `<CurrencyPersistor … />` line as the first child of `EmporixProvider` and add the `persistCurrency` param.)

Update the bottom-of-file `ConfigGate` render to pass `persistCurrency`:

```tsx
  return (
    <ConfigGate>
      {(config, reset, persist) => (
        <DemoApp config={config} reset={reset} persistCurrency={(c) => persist({ currency: c })} />
      )}
    </ConfigGate>
  );
```

- [ ] **Step 4: Typecheck the demo**

```bash
pnpm -F @viu/emporix-sdk-react build   # demo resolves the React pkg from dist (Task 1 change)
pnpm -F @viu/emporix-examples-storefront-demo typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/storefront-demo/src/config/useDemoConfig.ts examples/storefront-demo/src/config/ConfigGate.tsx examples/storefront-demo/src/App.tsx
git commit -m "feat(examples): persist the active currency across reloads"
```

---

## Task 3: Changeset, full verify, live re-test, finish

- [ ] **Step 1: Extend the existing changeset**

Edit `.changeset/currency-switcher.md` — append to the body:

```md
On reload, the site-context `currency` now seeds from the client's configured
`context.currency` (instead of always deriving from the site default), so a
persisted currency choice is respected.
```

- [ ] **Step 2: Full verify**

```bash
pnpm -r --filter "./packages/*" build
pnpm -r typecheck
pnpm -r test
```
Expected: all pass (SDK + React suites green).

- [ ] **Step 3: Live re-test (Chrome DevTools)**

Start the demo (`pnpm -F @viu/emporix-examples-storefront-demo dev --port 5273 --strictPort`), configure tenant `viu` + the public storefront client id + advanced `main`/`CHF`/`CH`. Then:
1. Switch the header currency to **EUR** → confirm a fresh anon login with `currency=EUR` (network).
2. **Reload the page** → confirm: the currency dropdown still shows **EUR**, and the anon login/refresh now carries `currency=EUR` (the persisted choice is bound from the first request). No console errors.
3. Stop the dev server.

- [ ] **Step 4: Finish**

```bash
git add .changeset/currency-switcher.md
git commit -m "chore(release): note currency-seed behaviour in changeset"
```

**REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch`. Branch `feat/demo-currency-switcher`.

---

## Self-Review

- **Spec coverage:** reload-persistence achieved by (T1) seeding `currency` from client config so the UI respects it + skips the site-DTO override, and (T2) persisting the active currency into `DemoConfig` so the rebuilt client binds it at anon-login. T3 verifies end-to-end incl. the reload that previously reverted.
- **No client rebuild / no on-mount re-login:** `persist` writes localStorage without `setConfig`; the currency is bound at the next reload's `buildClient`, not via a runtime re-bind.
- **Consistency:** `CurrencyPersistor` persists on *every* currency change (explicit `setCurrency` and `setSite`-driven), so `DemoConfig.currency` always matches the active site/currency → reload stays consistent.
- **Backward-compat:** clients without `context.currency` still seed `null` and derive from the site DTO (existing MS-2/MS-4 tests unaffected).
- **Naming:** `setCurrencyState` (state setter), `setCurrency` (public action), `persist`/`persistCurrency` are used consistently across tasks.
- **Placeholder scan:** every step has concrete code/commands; the only "unchanged" markers explicitly say to leave the existing subtree as-is.
