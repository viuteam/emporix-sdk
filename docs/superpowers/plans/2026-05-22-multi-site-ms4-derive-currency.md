# Multi-Site MS-4 — Currency Derivation + Login Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the multi-site foundation. `useSiteContext()` auto-derives `currency` and `targetLocation` from the active site's DTO (instead of always `null`), and the login flow honours the customer's `preferredSite` profile attribute.

**Architecture:** When `setSite(code)` is called, fetch the `Site` DTO via `client.sites.get(code)` (cached for 5 minutes through React-Query) and update `currency` + `targetLocation` from it. Then PATCH the session-context with all three fields. On provider mount, if a `siteCode` is already resolved (from prop / storage / static config), kick off the same fetch in an effect so `currency` / `targetLocation` populate without a user-driven switch. `useCustomerSession.login` checks `customer.preferredSite` after the session is established — if set and different from the current `useSiteContext().siteCode`, it calls `setSite(preferredSite)`.

**Tech Stack:** TypeScript, React 18, `@tanstack/react-query` v5, Vitest + MSW.

**Context for the engineer:**
- Spec: `docs/superpowers/specs/2026-05-21-multi-site-foundation-design.md` — read MS-4 section first.
- Branch: `feat/multi-site-ms4-derive-currency` (already created off `main` at `9bf2e2b`).
- MS-1 + MS-2 + MS-3 shipped. `client.sites`, `client.sessionContext`, `useSiteContext()`, async `setSite`, `isSwitching`, `switchError` are live.
- The Customer DTO field is `preferredSite` (single `f`) per `packages/sdk/src/generated/customer/types.gen.ts:157` — NOT the typo-variant `customerprefferedSite` that appears in some Emporix docs. The customer hook should read `customer.preferredSite`.
- The site's `targetLocation` comes from `site.homeBase.address.country` (per spec). That's the ISO country code consumed by the server's session-context.
- `client.sites.get(code)` is cacheable (sites change rarely). Use React-Query's `fetchQuery` with `staleTime: 5 * 60_000` so we don't refetch on every site switch.
- After `setSite` completes, the new currency + targetLocation are pushed into the same `sessionContext.patch` call alongside `siteCode` to keep server-side context fully in sync.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/react/src/provider.tsx` | Site context provider | Modify (derivation logic in setSite + mount-effect) |
| `packages/react/tests/use-site-context.test.tsx` | Site context tests | Add 4 MS-4 tests |
| `packages/react/src/hooks/use-customer-session.ts` | Login flow | Modify (honour `customer.preferredSite`) |
| `packages/react/tests/use-customer-session.test.tsx` | Customer-session tests | Add 2 MS-4 tests |
| `docs/react.md` | Public docs | Modify (Sites section) |
| `.changeset/multi-site-ms4.md` | Release notes | **CREATE** |

---

## Task 1: Derive `currency` + `targetLocation` from Site DTO inside `setSite`

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/use-site-context.test.tsx`:

```tsx
describe("useSiteContext — site DTO derivation (MS-4)", () => {
  it("setSite populates currency + targetLocation from site DTO", async () => {
    server.use(
      http.get("https://api.emporix.io/site/acme/sites/ThermoBrand_DE", () =>
        HttpResponse.json({
          code: "ThermoBrand_DE",
          name: "ThermoBrand Germany",
          active: true,
          default: false,
          defaultLanguage: "de",
          languages: ["de"],
          currency: "EUR",
          homeBase: { address: { country: "DE", zipCode: "12345" } },
          shipToCountries: ["DE"],
        }),
      ),
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ sessionId: "s", metadata: { version: 1 } }),
      ),
      http.patch(
        "https://api.emporix.io/session-context/acme/me/context",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap() });
    await act(async () => {
      await result.current.setSite("ThermoBrand_DE");
    });
    expect(result.current.currency).toBe("EUR");
    expect(result.current.targetLocation).toBe("DE");
  });

  it("setSite sends currency + targetLocation in the session-context PATCH", async () => {
    let patchBody: { siteCode?: string; currency?: string; targetLocation?: string } | undefined;
    server.use(
      http.get("https://api.emporix.io/site/acme/sites/main", () =>
        HttpResponse.json({
          code: "main",
          name: "Main",
          active: true,
          default: true,
          defaultLanguage: "de",
          languages: ["de"],
          currency: "CHF",
          homeBase: { address: { country: "CH", zipCode: "8000" } },
          shipToCountries: ["CH"],
        }),
      ),
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ sessionId: "s", metadata: { version: 1 } }),
      ),
      http.patch("https://api.emporix.io/session-context/acme/me/context", async ({ request }) => {
        patchBody = (await request.json()) as typeof patchBody;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap() });
    await act(async () => {
      await result.current.setSite("main");
    });
    expect(patchBody?.siteCode).toBe("main");
    expect(patchBody?.currency).toBe("CHF");
    expect(patchBody?.targetLocation).toBe("CH");
  });

  it("setSite(null) clears currency + targetLocation alongside siteCode", async () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("X");
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap({ storage }) });
    await act(async () => {
      await result.current.setSite(null);
    });
    expect(result.current.siteCode).toBeNull();
    expect(result.current.currency).toBeNull();
    expect(result.current.targetLocation).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: FAIL — currency/targetLocation stay `null` in MS-3.

- [ ] **Step 3: Update `SiteContextProvider` in `packages/react/src/provider.tsx`**

Replace the existing `SiteContextProvider` function body with:

```tsx
function SiteContextProvider({
  client,
  storage,
  initialSiteCode,
  children,
}: {
  client: EmporixClient;
  storage: EmporixStorage;
  initialSiteCode?: string;
  children: ReactNode;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [siteCode, setSiteCodeState] = useState<string | null>(() => {
    if (initialSiteCode !== undefined) return initialSiteCode;
    const fromStorage = storage.getSiteCode();
    if (fromStorage !== null) return fromStorage;
    return client.config?.credentials?.storefront?.context?.siteCode ?? null;
  });
  const [currency, setCurrency] = useState<string | null>(null);
  const [targetLocation, setTargetLocation] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<Error | null>(null);

  const setSite = useCallback(
    async (code: string | null) => {
      // 1) Optimistic flip — UI moves immediately.
      storage.setSiteCode(code);
      storage.setCartId(null);
      setSiteCodeState(code);
      setSwitchError(null);
      void qc.invalidateQueries({ queryKey: ["emporix"] });

      if (code === null) {
        setCurrency(null);
        setTargetLocation(null);
        return;
      }

      setIsSwitching(true);
      try {
        const token = storage.getCustomerToken();
        const authCtx = token ? auth.customer(token) : auth.anonymous();
        // 2) Derive currency + targetLocation from the site DTO (cached 5min).
        const site = await qc.fetchQuery({
          queryKey: ["emporix", "site-by-code", code, { tenant: client.tenant, authKind: authCtx.kind }],
          queryFn: () => client.sites.get(code, authCtx),
          staleTime: 5 * 60_000,
        });
        const nextCurrency = site.currency;
        const nextTarget = site.homeBase?.address?.country ?? null;
        setCurrency(nextCurrency);
        setTargetLocation(nextTarget);
        // 3) Push everything into the session-context PATCH.
        await client.sessionContext.patch(
          {
            siteCode: code,
            ...(nextCurrency ? { currency: nextCurrency } : {}),
            ...(nextTarget ? { targetLocation: nextTarget } : {}),
          },
          authCtx,
        );
      } catch (e) {
        setSwitchError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsSwitching(false);
      }
    },
    [client, storage, qc],
  );

  const value = useMemo<SiteContextValue>(
    () => ({
      siteCode,
      currency,
      targetLocation,
      setSite,
      isSwitching,
      switchError,
    }),
    [siteCode, currency, targetLocation, setSite, isSwitching, switchError],
  );

  return <EmporixSiteContext.Provider value={value}>{children}</EmporixSiteContext.Provider>;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: PASS for all 13 MS-2/MS-3 tests + 3 new MS-4 tests = 16 total.

If the MS-3 PATCH test (which asserts `patchBody.siteCode === "new-site"` and `metadata.version === 5`) breaks because the PATCH body now also carries `currency`/`targetLocation`, it shouldn't — the `expect.objectContaining` style assertion accepts additional fields. Verify the test does not use strict-equal on the entire body.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): derive currency + targetLocation from site DTO"
```

---

## Task 2: Auto-fetch Site DTO on provider mount (when `siteCode` is pre-resolved)

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-site-context.test.tsx` (still inside the MS-4 describe block):

```tsx
it("populates currency + targetLocation on mount when siteCode is pre-resolved", async () => {
  server.use(
    http.get("https://api.emporix.io/site/acme/sites/main", () =>
      HttpResponse.json({
        code: "main",
        name: "Main",
        active: true,
        default: true,
        defaultLanguage: "de",
        languages: ["de"],
        currency: "CHF",
        homeBase: { address: { country: "CH", zipCode: "8000" } },
        shipToCountries: ["CH"],
      }),
    ),
  );
  const { result } = renderHook(() => useSiteContext(), {
    wrapper: wrap({ initialSiteCode: "main" }),
  });
  await waitFor(() => expect(result.current.currency).toBe("CHF"));
  expect(result.current.targetLocation).toBe("CH");
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: FAIL — currency stays `null` because no fetch happens at mount.

- [ ] **Step 3: Add the mount-effect**

In `SiteContextProvider`, add a `useEffect` after the state declarations (and before `setSite`):

```tsx
import { useEffect } from "react";   // ← ensure useEffect is imported at the top of provider.tsx
```

```tsx
// Mount-time derivation: if a siteCode is already resolved, fetch its DTO
// once so currency + targetLocation populate without a user-driven switch.
useEffect(() => {
  if (!siteCode || currency !== null) return;
  let cancelled = false;
  const token = storage.getCustomerToken();
  const authCtx = token ? auth.customer(token) : auth.anonymous();
  qc.fetchQuery({
    queryKey: ["emporix", "site-by-code", siteCode, { tenant: client.tenant, authKind: authCtx.kind }],
    queryFn: () => client.sites.get(siteCode, authCtx),
    staleTime: 5 * 60_000,
  })
    .then((site) => {
      if (cancelled) return;
      setCurrency(site.currency);
      setTargetLocation(site.homeBase?.address?.country ?? null);
    })
    .catch(() => {
      // Best-effort — silent. setSite-driven derivation surfaces real errors.
    });
  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [siteCode]);
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: PASS for the new mount-derivation test.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): auto-fetch site DTO on mount when siteCode is set"
```

---

## Task 3: Honour `customer.preferredSite` at login

**Files:**
- Modify: `packages/react/src/hooks/use-customer-session.ts`
- Test: `packages/react/tests/use-customer-session.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/use-customer-session.test.tsx` (after existing customer-session tests):

```tsx
describe("useCustomerSession — preferredSite honour (MS-4)", () => {
  it("switches active site to customer.preferredSite after login", async () => {
    let patchCall: { siteCode?: string } | undefined;
    server.use(
      http.post("https://api.emporix.io/customer/acme/login", () =>
        HttpResponse.json({
          customerToken: "cust-tok",
          refreshToken: "rt",
          saasToken: "sasaas",
        }),
      ),
      http.get("https://api.emporix.io/customer/acme/me", () =>
        HttpResponse.json({ id: "c1", contactEmail: "u@e.com", preferredSite: "Y" }),
      ),
      http.get("https://api.emporix.io/site/acme/sites/Y", () =>
        HttpResponse.json({
          code: "Y",
          name: "Y",
          active: true,
          default: false,
          defaultLanguage: "en",
          languages: ["en"],
          currency: "EUR",
          homeBase: { address: { country: "DE", zipCode: "1" } },
          shipToCountries: ["DE"],
        }),
      ),
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ sessionId: "s", metadata: { version: 1 } }),
      ),
      http.patch("https://api.emporix.io/session-context/acme/me/context", async ({ request }) => {
        patchCall = (await request.json()) as typeof patchCall;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const storage = createMemoryStorage();
    storage.setSiteCode("X"); // Current site differs from customer preference.
    const { result } = renderHook(
      () => ({ session: useCustomerSession(), site: useSiteContext() }),
      { wrapper: wrapper(storage, { siteCode: "main" }) },
    );
    await act(async () => {
      await result.current.session.login({ email: "u@e.com", password: "p" });
    });
    await waitFor(() => expect(result.current.site.siteCode).toBe("Y"));
    expect(patchCall?.siteCode).toBe("Y");
  });

  it("leaves site unchanged when customer has no preferredSite", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/login", () =>
        HttpResponse.json({ customerToken: "tok", refreshToken: "rt", saasToken: "ss" }),
      ),
      http.get("https://api.emporix.io/customer/acme/me", () =>
        HttpResponse.json({ id: "c1", contactEmail: "u@e.com" }), // No preferredSite.
      ),
    );
    const storage = createMemoryStorage();
    storage.setSiteCode("X");
    const { result } = renderHook(
      () => ({ session: useCustomerSession(), site: useSiteContext() }),
      { wrapper: wrapper(storage, { siteCode: "main" }) },
    );
    await act(async () => {
      await result.current.session.login({ email: "u@e.com", password: "p" });
    });
    // Site stays as it was — no preference to honour.
    expect(result.current.site.siteCode).toBe("X");
  });
});
```

You may need to import `useSiteContext` at the top of the test file (it's already used in other tests through wrapper helpers — verify before adding).

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session`
Expected: FAIL — `useCustomerSession.login` does not yet read `preferredSite`.

- [ ] **Step 3: Update `useCustomerSession.login`**

In `packages/react/src/hooks/use-customer-session.ts`, find the existing `login` callback (it runs `onboardCustomerCart` and invalidates queries today). After `qc.invalidateQueries({ queryKey: ["emporix", "cart"] })`, add a `preferredSite`-honour step. Three pieces:

1. Import the EmporixSiteContext to access `setSite`:
   ```ts
   import { useContext } from "react";
   import { EmporixSiteContext } from "../provider";
   ```

2. Inside the `useCustomerSession` function body, grab the site context (best-effort — it may be `null` if no SiteContextProvider is mounted, which is OK):
   ```ts
   const siteCtx = useContext(EmporixSiteContext);
   ```

3. Inside `login` (and the same `applySession` helper used by `socialLogin`/`exchangeToken`), AFTER the customer cart-onboarding and cache-invalidations, add:
   ```ts
   try {
     const me = await client.customers.getMe(auth.customer(session.customerToken));
     const preferred = (me as { preferredSite?: string }).preferredSite;
     if (preferred && siteCtx && siteCtx.siteCode !== preferred) {
       await siteCtx.setSite(preferred);
     }
   } catch {
     // Best-effort — never block login on a preference lookup.
   }
   ```

Adjust to match the existing pattern in the file (e.g. if `me` is already fetched inside `applySession`, reuse it instead of fetching again).

If `client.customers.getMe` isn't the right method name, check the existing customer service usage in this file — it likely calls `meQuery.refetch()` or similar. The goal is to read `preferredSite` from the freshly-loaded customer profile.

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session`
Expected: PASS for all existing customer-session tests + 2 new MS-4 tests.

If the existing `useCustomerSession.test.tsx` wrapper helper doesn't mount the site-context provider correctly (because it predates MS-2), inspect the `wrapper` function — it may need to use the standard `EmporixProvider` (which wraps in `SiteContextProvider` automatically post-MS-2). If a custom QueryClient pattern is used, ensure it stays inside the provider.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-customer-session.ts \
        packages/react/tests/use-customer-session.test.tsx
git commit -m "feat(react): honour customer.preferredSite at login"
```

---

## Task 4: Docs + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/multi-site-ms4.md`

- [ ] **Step 1: Update `docs/react.md` Sites section**

Replace the "In MS-4 `currency` and `targetLocation` auto-derive …" sentence with:

```markdown
`useSiteContext()` exposes `currency` and `targetLocation` derived from the
active site's DTO (cached for 5 minutes via React-Query). On a `setSite`
call, the SDK fetches the new site's DTO, updates these fields, and pushes
all three (`siteCode`, `currency`, `targetLocation`) into the session-context
PATCH. On provider mount with a pre-resolved `siteCode`, the same fetch
happens once so the values are available immediately.

After a successful login, `useCustomerSession` honours `customer.preferredSite`:
if the customer profile carries a preferred site different from the active
one, the SDK calls `setSite(preferredSite)` automatically — including the
server-side PATCH. To opt out, fetch the customer profile first and decide in
your UI before calling `login()` (uncommon; preference-driven behavior is the
expected storefront default).
```

- [ ] **Step 2: Create changeset**

Create `.changeset/multi-site-ms4.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Multi-site MS-4: currency + targetLocation auto-derive, preferredSite honour.

**Provider**
- `useSiteContext().currency` and `useSiteContext().targetLocation` are no
  longer always `null`. They derive from the active site's DTO
  (`site.currency` and `site.homeBase.address.country`), cached for 5
  minutes via React-Query.
- `setSite(code)` fetches the site DTO, populates `currency` /
  `targetLocation`, and includes all three fields in the `sessionContext.patch`
  body so the server is fully in sync.
- On provider mount with a pre-resolved `siteCode` (from `initialSiteCode`
  prop, storage, or static config), the site DTO is fetched once so
  `currency` and `targetLocation` populate without a user-driven switch.

**Login**
- `useCustomerSession.login` (and `socialLogin` / `exchangeToken`) now read
  `customer.preferredSite`. If it's set and differs from the active site,
  the SDK calls `setSite(preferredSite)` — same flow as a user-driven
  switch. Best-effort: a failure here never blocks login.

No breaking changes. Storefronts without `preferredSite` set on their
customers see no behavior change.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/multi-site-ms4.md
git commit -m "docs(repo): document currency derivation + preferredSite; MS-4 changeset"
```

---

## Final Verification

- [ ] **Step 1: Full monorepo green**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```
Expected:
- `@viu/emporix-sdk`: still 156 tests.
- `@viu/emporix-sdk-react`: was 127 → **≥ 133** (+4 site-context MS-4 + +2 customer-session MS-4).
- All builds + typecheck green.

- [ ] **Step 2: E2E sanity**

```bash
set -a; source e2e/.env.local 2>/dev/null; set +a
pnpm e2e
```
Expected: 6/6 still passing. If a customer-session e2e starts switching sites unexpectedly because the test user has a `preferredSite` set, the test needs a flag to disable the preference-honour (out of scope here — the spec defines this as default storefront UX). If you see this regression, document and proceed; do not introduce a flag in this PR.

- [ ] **Step 3: Branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 5 commits, in order:
1. MS-4 plan (this file)
2. Site DTO derivation in setSite
3. Mount-effect site DTO fetch
4. preferredSite honour at login
5. Docs + changeset

---

## Multi-Site Foundation Complete

After MS-4 lands, the multi-site foundation is functionally complete:

| Stage | Delivered |
|---|---|
| MS-1 | `client.sites` service + `useSites()` / `useDefaultSite()` |
| MS-2 | `useSiteContext()` + `initialSiteCode` prop + cache-key migration |
| MS-3 | `client.sessionContext` + async `setSite` with `isSwitching` / `switchError` |
| MS-4 | Currency + targetLocation derivation + `preferredSite` at login |

## Follow-ups (out of scope)

- Site-switcher UI in `examples/vite-spa` and `examples/next-app-router`.
- `prefetchSites` / `prefetchSiteContext` SSR helpers.
- Storage-watcher for cross-tab site-switch sync (Pub/Sub on `emporix.siteCode`).
- B2B legal-entity context as a first-class runtime concept (parallel to site).
