# Language Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime language switch so a storefront can change which language the Emporix data texts (product/category names & descriptions) render in, via an `Accept-Language` header — modeled on the existing `setCurrency` flow.

**Architecture:** The active language is a storefront-context value. The SDK holds one shared `requestContext` object that every `HttpClient` reads to inject `Accept-Language` on each request; `client.setStorefrontContext({ language })` mutates it (no token re-mint). React exposes `language` + `setLanguage` on `SiteContextValue`, persists the choice in `EmporixStorage` (`emporix.language`), mirrors it into the server session context, and adds `language` to the React-Query keys of localized reads so the cache never serves stale-language strings. A `LanguageSwitcher` in the storefront-demo demonstrates it.

**Tech Stack:** TypeScript, `@tanstack/react-query`, Vitest + MSW (`msw/node`), `@testing-library/react`. Monorepo via pnpm.

**Spec:** `docs/superpowers/specs/2026-06-08-language-switch-design.md`

---

## File Structure

**SDK (`packages/sdk`):**
- Modify `src/core/http.ts` — add `requestContext` to `HttpClientOptions`; inject `Accept-Language` via a shared `buildHeaders` helper used by `request` + `requestRaw`.
- Modify `src/core/config.ts` — add `language?: string` to the storefront `context` type.
- Modify `src/client.ts` — create the shared `requestContext`, pass it to every `HttpClient`, extend `setStorefrontContext` with `language`.
- Create `tests/http-accept-language.test.ts`, `tests/client-storefront-language.test.ts`.

**React (`packages/react`):**
- Modify `src/storage/index.ts` — `getLanguage`/`setLanguage` on `EmporixStorage`; add `"language"` to `EmporixStorageKey`.
- Modify `src/storage/memory.ts`, `src/storage/local-storage.ts`, `src/storage/cookie.ts` — implement the two methods.
- Modify `src/provider.tsx` — `language` + `setLanguage` on `SiteContextValue`; `initialLanguage` prop; state init, `setLanguage`, mount-derive, site-switch reset.
- Modify `src/hooks/internal/use-read-site.ts` — also return `language`.
- Modify `src/hooks/internal/query-keys.ts` — add `language` to the meta object.
- Modify localized read hooks: `use-products.ts`, `use-categories.ts`, `use-variant-children.ts`, `use-cart.ts`, `use-shopping-lists.ts`, `use-my-segments.ts`, `use-my-orders.ts`, `use-my-orders-infinite.ts`, `use-order.ts`, `use-sales-order.ts`.
- Modify `tests/storage.test.ts`, `tests/use-site-context.test.tsx`; create `tests/use-language-keys.test.tsx`.

**Example (`examples/storefront-demo`):**
- Create `src/app/LanguageSwitcher.tsx`; modify `src/app/Header.tsx`.

**Release:**
- Create a changeset under `.changeset/`.

---

## Task 1: SDK — inject `Accept-Language` in `HttpClient`

**Files:**
- Modify: `packages/sdk/src/core/http.ts`
- Test: `packages/sdk/tests/http-accept-language.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/http-accept-language.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import type { TokenProvider } from "../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON",
    refreshToken: "r",
    sessionId: "s",
    expiresIn: 3599,
  }),
};

let seen: Record<string, string | null> = {};
const server = setupServer(
  mhttp.get("https://api.emporix.io/echo", ({ request }) => {
    seen = { acceptLanguage: request.headers.get("accept-language") };
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen = {};
});
afterAll(() => server.close());

function client(requestContext?: { language?: string }) {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "checkout" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
    ...(requestContext ? { requestContext } : {}),
  });
}

describe("HttpClient Accept-Language", () => {
  it("injects Accept-Language from requestContext.language", async () => {
    await client({ language: "de" }).request({
      method: "GET",
      path: "/echo",
      auth: { kind: "anonymous" },
    });
    expect(seen.acceptLanguage).toBe("de");
  });

  it("omits Accept-Language when no language is set", async () => {
    await client().request({
      method: "GET",
      path: "/echo",
      auth: { kind: "anonymous" },
    });
    expect(seen.acceptLanguage).toBeNull();
  });

  it("lets a per-request header override the context language", async () => {
    await client({ language: "de" }).request({
      method: "GET",
      path: "/echo",
      auth: { kind: "anonymous" },
      headers: { "Accept-Language": "fr" },
    });
    expect(seen.acceptLanguage).toBe("fr");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/http-accept-language.test.ts`
Expected: FAIL — `requestContext` is not a known option / header is `null` when `de` expected.

- [ ] **Step 3: Add `requestContext` to `HttpClientOptions`**

In `packages/sdk/src/core/http.ts`, inside `interface HttpClientOptions`, after the `customerRefresh?` field:

```ts
  /** Opt-in customer-token refresher registry (off unless a refresher is set). */
  customerRefresh?: CustomerRefreshRegistry;
  /**
   * Shared storefront request context. When `language` is set, every request
   * carries `Accept-Language: <language>`. Mutated at runtime via
   * `EmporixClient.setStorefrontContext({ language })`.
   */
  requestContext?: { language?: string };
```

- [ ] **Step 4: Add a shared `buildHeaders` helper and use it in both request paths**

In `packages/sdk/src/core/http.ts`, add this private method to the `HttpClient` class (place it right after the `constructor`):

```ts
  private buildHeaders(
    o: RequestOptions,
    token: string,
    isFormData: boolean,
  ): Record<string, string> {
    return {
      ...(this.opts.requestContext?.language
        ? { "Accept-Language": this.opts.requestContext.language }
        : {}),
      ...(o.headers ?? {}),
      Authorization: `Bearer ${token}`,
      // JSON bodies: set Content-Type. FormData bodies: let `fetch`
      // emit `multipart/form-data; boundary=...` itself.
      ...(o.body !== undefined && !isFormData
        ? { "Content-Type": "application/json" }
        : {}),
    };
  }
```

In `request()`, replace the inline `headers: { ... }` block of the `init` object with:

```ts
      const init: RequestInit = {
        method: o.method,
        headers: this.buildHeaders(o, token, isFormData),
        signal: controller.signal,
      };
```

In `requestRaw()`, replace its inline `headers: { ... }` block likewise (note: keep the existing `redirect` spread):

```ts
    const init: RequestInit = {
      method: o.method,
      headers: this.buildHeaders(o, token, isFormData),
      signal: controller.signal,
      ...(extra?.redirect ? { redirect: extra.redirect } : {}),
    };
```

The `Accept-Language` base sits first so a per-request `o.headers` value overrides it, and `Authorization` is applied last so it can never be overridden — preserving the existing `http-headers.test.ts` guarantees.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/http-accept-language.test.ts tests/http-headers.test.ts`
Expected: PASS (both files — confirms the refactor didn't regress the existing header tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/tests/http-accept-language.test.ts
git commit -m "feat(http): inject Accept-Language from shared request context" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: SDK — add `language` to the storefront config context type

**Files:**
- Modify: `packages/sdk/src/core/config.ts:28`

- [ ] **Step 1: Widen the `context` type**

In `packages/sdk/src/core/config.ts`, inside `interface StorefrontCredentials`, change the `context` field:

```ts
  context?: { currency?: string; siteCode?: string; targetLocation?: string; language?: string };
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS (no callers broken — the field is optional).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/core/config.ts
git commit -m "feat(core): allow language in storefront config context" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: SDK — shared `requestContext` + `setStorefrontContext({ language })`

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Test: `packages/sdk/tests/client-storefront-language.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/client-storefront-language.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { EmporixClient, auth } from "../src";
import type { TokenProvider } from "../src/core/auth";

function makeProvider(setAnonymousContext = vi.fn()): TokenProvider {
  return {
    getToken: async () => "SVC",
    getAnonymousToken: async () => ({
      accessToken: "ANON",
      refreshToken: "r",
      sessionId: "s",
      expiresIn: 3599,
    }),
    setAnonymousContext,
  } as unknown as TokenProvider;
}

let acceptLanguage: string | null = null;
const server = setupServer(
  mhttp.get("https://api.emporix.io/site/acme/sites", ({ request }) => {
    acceptLanguage = request.headers.get("accept-language");
    return HttpResponse.json([]);
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  acceptLanguage = null;
});
afterAll(() => server.close());

function makeClient(tokenProvider: TokenProvider) {
  return new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf" },
    },
    tokenProvider,
    logger: false,
  });
}

describe("EmporixClient.setStorefrontContext language", () => {
  it("sends Accept-Language on a service call after setStorefrontContext({ language })", async () => {
    const client = makeClient(makeProvider());
    client.setStorefrontContext({ language: "de" });
    await client.sites.list(auth.anonymous());
    expect(acceptLanguage).toBe("de");
  });

  it("a language-only change does NOT re-mint the anonymous token", async () => {
    const setAnonymousContext = vi.fn();
    const client = makeClient(makeProvider(setAnonymousContext));
    client.setStorefrontContext({ language: "de" });
    expect(setAnonymousContext).not.toHaveBeenCalled();
  });

  it("a currency change still re-mints (setAnonymousContext called without language)", async () => {
    const setAnonymousContext = vi.fn();
    const client = makeClient(makeProvider(setAnonymousContext));
    client.setStorefrontContext({ currency: "USD" });
    expect(setAnonymousContext).toHaveBeenCalledWith({ currency: "USD" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/client-storefront-language.test.ts`
Expected: FAIL — `Accept-Language` is `null`; `setStorefrontContext` does not accept `language` / still re-mints.

- [ ] **Step 3: Create the shared `requestContext` in the constructor**

In `packages/sdk/src/client.ts`, add a private field next to the other private fields (near `private readonly resolver: LevelResolver;`):

```ts
  private readonly requestContext: { language?: string };
```

In the constructor, immediately before `const mk = (service: ServiceName): ClientContext => ({`, add:

```ts
    this.requestContext = { language: cfg.credentials.storefront?.context?.language };
    const requestContext = this.requestContext;
```

Then add `requestContext` to the `HttpClient` options inside `mk`:

```ts
      http: new HttpClient({
        host: cfg.host,
        provider: tokenProvider,
        logger: root.child({ service: "http" }),
        retry: cfg.retry,
        timeouts: cfg.timeouts,
        customerRefresh,
        requestContext,
      }),
```

All services share the one `requestContext` object by reference, so a later mutation reaches every `HttpClient`.

- [ ] **Step 4: Extend `setStorefrontContext`**

In `packages/sdk/src/client.ts`, replace the existing `setStorefrontContext` method body:

```ts
  setStorefrontContext(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  }): void {
    if (ctx.language !== undefined) {
      this.requestContext.language = ctx.language || undefined;
    }
    const { language: _language, ...priceContext } = ctx;
    // Only currency/site/target re-mint the anonymous token; a language-only
    // change is just a request header and must NOT trigger a re-mint.
    if (Object.keys(priceContext).length > 0) {
      this.tokenProvider.setAnonymousContext?.(priceContext);
    }
  }
```

Also update the JSDoc above the method to mention `language` (one added sentence): `Also sets the storefront `language` (an `Accept-Language` header on every read); language-only changes do not re-mint the token.`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/client-storefront-language.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full SDK suite + typecheck**

Run: `pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/tests/client-storefront-language.test.ts
git commit -m "feat(sdk): add language to setStorefrontContext (Accept-Language)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: React — `EmporixStorage` language interface + key

**Files:**
- Modify: `packages/react/src/storage/index.ts`

- [ ] **Step 1: Add the two methods to the interface**

In `packages/react/src/storage/index.ts`, inside `interface EmporixStorage`, after the `getSiteCode`/`setSiteCode` pair:

```ts
  // Active site code (MS-2). `null` = no site bound yet.
  getSiteCode(): string | null;
  setSiteCode(code: string | null): void;

  // Active language (Accept-Language). `null` = use the site/tenant default.
  getLanguage(): string | null;
  setLanguage(language: string | null): void;
```

- [ ] **Step 2: Add `"language"` to the storage-key union**

In the same file, extend `EmporixStorageKey`:

```ts
export type EmporixStorageKey =
  | "customerToken"
  | "cartId"
  | "siteCode"
  | "language"
  | "anonymousSession"
  | "activeLegalEntityId"
  | "refreshToken";
```

- [ ] **Step 3: Verify it fails to typecheck (adapters now incomplete)**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: FAIL — the three storage adapters no longer satisfy `EmporixStorage` (missing `getLanguage`/`setLanguage`). This confirms Task 5 is required next.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/storage/index.ts
git commit -m "feat(react): add language to EmporixStorage interface" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: React — implement `getLanguage`/`setLanguage` in the three adapters

**Files:**
- Modify: `packages/react/src/storage/memory.ts`, `src/storage/local-storage.ts`, `src/storage/cookie.ts`
- Test: `packages/react/tests/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/storage.test.ts` (use the same imports the file already has for `createMemoryStorage`, `createLocalStorageStorage`, `createCookieStorage`; add any that are missing):

```ts
describe("language round-trip", () => {
  it("memory storage stores and clears language", () => {
    const s = createMemoryStorage();
    expect(s.getLanguage()).toBeNull();
    s.setLanguage("de");
    expect(s.getLanguage()).toBe("de");
    s.setLanguage(null);
    expect(s.getLanguage()).toBeNull();
  });

  it("localStorage storage persists language under emporix.language", () => {
    const s = createLocalStorageStorage();
    s.setLanguage("de");
    expect(globalThis.localStorage.getItem("emporix.language")).toBe("de");
    expect(s.getLanguage()).toBe("de");
    s.setLanguage(null);
    expect(globalThis.localStorage.getItem("emporix.language")).toBeNull();
  });

  it("cookie storage stores and reads language", () => {
    const s = createCookieStorage();
    s.setLanguage("de");
    expect(s.getLanguage()).toBe("de");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/storage.test.ts`
Expected: FAIL — `getLanguage`/`setLanguage` are not implemented.

- [ ] **Step 3: Implement in `memory.ts`**

In `packages/react/src/storage/memory.ts`, add a backing variable next to `let siteCode`:

```ts
  let siteCode: string | null = null;
  let language: string | null = null;
```

And add the methods in the returned object, right after `setSiteCode`:

```ts
    getSiteCode: () => siteCode,
    setSiteCode: (code) => {
      siteCode = code;
      all.notify("siteCode");
    },
    getLanguage: () => language,
    setLanguage: (l) => {
      language = l;
      all.notify("language");
    },
```

- [ ] **Step 4: Implement in `local-storage.ts`**

In `packages/react/src/storage/local-storage.ts`, add a key constant next to `const SITE_KEY`:

```ts
const SITE_KEY = "emporix.siteCode";
const LANGUAGE_KEY = "emporix.language";
```

And add the methods right after `setSiteCode`:

```ts
    getSiteCode: () => ls.getItem(SITE_KEY),
    setSiteCode: (code) => {
      if (code === null) ls.removeItem(SITE_KEY);
      else ls.setItem(SITE_KEY, code);
      all.notify("siteCode");
    },
    getLanguage: () => ls.getItem(LANGUAGE_KEY),
    setLanguage: (l) => {
      if (l === null) ls.removeItem(LANGUAGE_KEY);
      else ls.setItem(LANGUAGE_KEY, l);
      all.notify("language");
    },
```

- [ ] **Step 5: Implement in `cookie.ts`**

In `packages/react/src/storage/cookie.ts`, add a name constant next to `const SITE_NAME`:

```ts
const SITE_NAME = "emporix.siteCode";
const LANGUAGE_NAME = "emporix.language";
```

And add the methods right after `setSiteCode`:

```ts
    getSiteCode: () => readCookie(SITE_NAME),
    setSiteCode: (code) => {
      writeCookie(SITE_NAME, code);
      all.notify("siteCode");
    },
    getLanguage: () => readCookie(LANGUAGE_NAME),
    setLanguage: (l) => {
      writeCookie(LANGUAGE_NAME, l);
      all.notify("language");
    },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/storage.test.ts && pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS (typecheck now green — adapters satisfy the interface again).

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/storage/memory.ts packages/react/src/storage/local-storage.ts packages/react/src/storage/cookie.ts packages/react/tests/storage.test.ts
git commit -m "feat(react): implement language storage in all three adapters" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: React — `SiteContextValue.language` + `initialLanguage` prop + state init

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/use-site-context.test.tsx` a new describe block. (The `wrap` helper and `makeClient` already exist in this file; extend `wrap`'s option type inline as shown.)

```ts
describe("useSiteContext — language initial resolution", () => {
  it("uses initialLanguage prop when provided", () => {
    const client = makeClient();
    const storage = createMemoryStorage();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient} initialLanguage="de">
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: Wrapper });
    expect(result.current.language).toBe("de");
  });

  it("falls back to storage.getLanguage() when no prop", () => {
    const storage = createMemoryStorage();
    storage.setLanguage("fr");
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap({ storage }) });
    expect(result.current.language).toBe("fr");
  });

  it("falls back to null when nothing is configured", () => {
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap() });
    expect(result.current.language).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx -t "language initial resolution"`
Expected: FAIL — `language` is `undefined`; `initialLanguage` is not a known prop.

- [ ] **Step 3: Extend `SiteContextValue`**

In `packages/react/src/provider.tsx`, inside `interface SiteContextValue`, add `language` after `targetLocation` and `setLanguage` after `setCurrency`:

```ts
  /** MS-4 populates this from the active site's DTO. */
  targetLocation: string | null;
  /** Active language for localized reads (Accept-Language). `null` = site/tenant default. */
  language: string | null;
```

```ts
  setCurrency: (currency: string) => Promise<void>;
  /**
   * Switch the active language at runtime. Sets the `Accept-Language` request
   * header (via `setStorefrontContext`), invalidates the React-Query cache so
   * localized reads refetch, and PATCHes an existing server session context.
   * Does NOT clear the cart (language does not affect pricing).
   */
  setLanguage: (language: string) => Promise<void>;
```

- [ ] **Step 4: Add `initialLanguage` to the provider props and forward it**

In `interface EmporixProviderProps`, after `initialSiteCode`:

```ts
  /**
   * Initial active language. Resolution order: this prop → `storage.getLanguage()`
   * → `client.config.credentials.storefront.context.language` → `null` (then
   * seeded from the active site's `defaultLanguage` on mount).
   */
  initialLanguage?: string;
```

Add `initialLanguage` to the `EmporixProvider` destructured params and forward it to `SiteContextProvider`. In the `EmporixProvider` signature add `initialLanguage,` next to `initialSiteCode,`. In the returned JSX, on the `<SiteContextProvider …>` element add:

```tsx
          <SiteContextProvider
            client={client}
            storage={val.storage}
            {...(initialSiteCode !== undefined ? { initialSiteCode } : {})}
            {...(initialLanguage !== undefined ? { initialLanguage } : {})}
          >
```

- [ ] **Step 5: Add `initialLanguage` to `SiteContextProvider` and initialize state**

In `SiteContextProvider`'s prop type, add `initialLanguage?: string;` next to `initialSiteCode?: string;`, and add `initialLanguage,` to its destructured params.

Add the `language` state next to the `currency` state:

```ts
  const [language, setLanguageState] = useState<string | null>(() => {
    if (initialLanguage !== undefined) return initialLanguage;
    const fromStorage = storage.getLanguage();
    if (fromStorage !== null) return fromStorage;
    return client.config?.credentials?.storefront?.context?.language ?? null;
  });
```

- [ ] **Step 6: Expose `language` + a placeholder `setLanguage` in the context value**

So the file typechecks before Task 7 fills in the real `setLanguage`, add a temporary no-op and wire `language`. In the `useMemo<SiteContextValue>` value object add `language,` and `setLanguage,`. Define `setLanguage` just above the `useMemo` as a minimal stub that updates state + storage (the full implementation lands in Task 7):

```ts
  const setLanguage = useCallback(
    async (next: string) => {
      storage.setLanguage(next);
      setLanguageState(next);
    },
    [storage],
  );
```

And in the memo value + deps:

```ts
  const value = useMemo<SiteContextValue>(
    () => ({
      siteCode,
      currency,
      targetLocation,
      language,
      setSite,
      setCurrency,
      setLanguage,
      isSwitching,
      switchError,
    }),
    [siteCode, currency, targetLocation, language, setSite, setCurrency, setLanguage, isSwitching, switchError],
  );
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx -t "language initial resolution" && pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): add language + initialLanguage to site context" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: React — full `setLanguage` implementation

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/use-site-context.test.tsx`:

```ts
describe("useSiteContext — setLanguage", () => {
  it("updates state + storage, sets the storefront context, patches the session", async () => {
    const client = makeClient();
    const storage = createMemoryStorage();
    storage.setSiteCode("main");
    const spy = vi.spyOn(client, "setStorefrontContext");
    let patchBody: { language?: string; siteCode?: string } | undefined;
    server.use(
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ sessionId: "s", siteCode: "main", metadata: { version: 3 } }),
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
      await result.current.setLanguage("de");
    });

    expect(result.current.language).toBe("de");
    expect(storage.getLanguage()).toBe("de");
    expect(spy).toHaveBeenCalledWith({ language: "de" });
    expect(patchBody?.language).toBe("de");
  });

  it("does NOT clear the cart on language switch", async () => {
    const storage = createMemoryStorage();
    storage.setCartId("keep-me");
    server.use(
      http.get(
        "https://api.emporix.io/session-context/acme/me/context",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap({ storage }) });
    await act(async () => {
      await result.current.setLanguage("de");
    });
    expect(storage.getCartId()).toBe("keep-me");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx -t "setLanguage"`
Expected: FAIL — the stub does not call `setStorefrontContext` or PATCH the session.

- [ ] **Step 3: Replace the `setLanguage` stub with the full implementation**

In `packages/react/src/provider.tsx`, replace the `setLanguage` `useCallback` from Task 6 with:

```ts
  const setLanguage = useCallback(
    async (next: string) => {
      storage.setLanguage(next);
      setLanguageState(next);
      setSwitchError(null);
      // Header source — applies to anonymous + pre-session reads too.
      client.setStorefrontContext({ language: next });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      setIsSwitching(true);
      try {
        const token = storage.getCustomerToken();
        const authCtx = token ? auth.customer(token) : auth.anonymous();
        await client.sessionContext.patch(
          { language: next, ...(siteCode ? { siteCode } : {}) },
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

(`auth` is already imported at the top of `provider.tsx`; `qc`, `setSwitchError`, `setIsSwitching`, `siteCode` are already in scope inside `SiteContextProvider`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx`
Expected: PASS (whole file — confirms no regression to the site/currency tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): implement setLanguage (session patch + cache invalidation)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: React — seed language from the site DTO on mount

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/use-site-context.test.tsx`

The existing mount-derive effect fetches the site DTO when `siteCode` is set. Extend it to seed `language` from `site.defaultLanguage` when still `null`.

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-site-context.test.tsx`:

```ts
describe("useSiteContext — language mount-derive", () => {
  it("seeds language from the site defaultLanguage when none is set", async () => {
    server.use(
      http.get("https://api.emporix.io/site/acme/sites/main", () =>
        HttpResponse.json({
          code: "main", name: "Main", active: true, default: true,
          defaultLanguage: "de", languages: ["de", "en"],
          currency: "CHF",
          homeBase: { address: { country: "CH", zipCode: "8000" } },
          shipToCountries: ["CH"],
        }),
      ),
    );
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ initialSiteCode: "main" }),
    });
    await waitFor(() => expect(result.current.language).toBe("de"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx -t "language mount-derive"`
Expected: FAIL — `language` stays `null`.

- [ ] **Step 3: Update the mount-derive effect**

In `packages/react/src/provider.tsx`, find the mount-derive `useEffect`. Change its early-return guard so it also runs when `language` is still null, and seed `language` inside the `.then`. Replace the effect's guard line and the `.then` body:

Guard (was `if (!siteCode || (currency !== null && targetLocation !== null)) return;`):

```ts
    if (!siteCode || (currency !== null && targetLocation !== null && language !== null)) return;
```

Inside `.then((site) => { … })`, after the existing `setTargetLocation(...)` line add:

```ts
        if (language === null && site.defaultLanguage) {
          setLanguageState(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
```

(The effect already lists `[siteCode]` deps with an eslint-disable for exhaustive-deps; keep it — `language`/`currency` are read as "seed only if still null" and must not retrigger the effect.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): seed language from site defaultLanguage on mount" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: React — reset language on site switch when unsupported

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/use-site-context.test.tsx`

When `setSite` switches to a site whose `languages` does not include the active language, reset to that site's `defaultLanguage`.

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-site-context.test.tsx`:

```ts
describe("useSiteContext — language reset on site switch", () => {
  it("resets language to the new site defaultLanguage when the active one is unsupported", async () => {
    server.use(
      http.get("https://api.emporix.io/site/acme/sites/fr-site", () =>
        HttpResponse.json({
          code: "fr-site", name: "FR", active: true, default: false,
          defaultLanguage: "fr", languages: ["fr"],
          currency: "EUR",
          homeBase: { address: { country: "FR", zipCode: "75001" } },
          shipToCountries: ["FR"],
        }),
      ),
      http.get(
        "https://api.emporix.io/session-context/acme/me/context",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ initialLanguage: "de", initialSiteCode: "old" }),
    });
    await act(async () => {
      await result.current.setSite("fr-site");
    });
    expect(result.current.language).toBe("fr");
  });
});
```

(`wrap` must forward `initialLanguage` — add `initialLanguage?: string` to its options type and spread it onto `<EmporixProvider>` exactly like `initialSiteCode`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx -t "language reset on site switch"`
Expected: FAIL — language stays `"de"`.

- [ ] **Step 3: Add the reset inside `setSite`**

In `packages/react/src/provider.tsx`, in the `setSite` `useCallback`, after `setTargetLocation(nextTarget);` (where `site` is already resolved) add:

```ts
        if (site.languages && !site.languages.includes(language ?? "") && site.defaultLanguage) {
          setLanguageState(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
```

Add `language` to the `setSite` `useCallback` dependency array (it currently lists `[client, storage, qc]`):

```ts
    [client, storage, qc, language],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-site-context.test.tsx`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): reset language to site default when unsupported on switch" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: React — `useReadSite` also returns `language`

**Files:**
- Modify: `packages/react/src/hooks/internal/use-read-site.ts`

- [ ] **Step 1: Update the helper**

Replace the body of `packages/react/src/hooks/internal/use-read-site.ts`:

```ts
import { useContext } from "react";
import { EmporixSiteContext } from "../../provider";

/**
 * Internal: returns the active `siteCode` and `language` from the
 * EmporixProvider's site context. Used by site-aware read hooks to compose
 * their query keys. Both are `null` when no site context is mounted.
 */
export function useReadSite(): { siteCode: string | null; language: string | null } {
  const ctx = useContext(EmporixSiteContext);
  return { siteCode: ctx?.siteCode ?? null, language: ctx?.language ?? null };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS (existing callers destructure only `siteCode` — non-breaking).

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/hooks/internal/use-read-site.ts
git commit -m "feat(react): expose language from useReadSite" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: React — add `language` dimension to `emporixKey`

**Files:**
- Modify: `packages/react/src/hooks/internal/query-keys.ts`

- [ ] **Step 1: Extend the context param + meta**

In `packages/react/src/hooks/internal/query-keys.ts`, update the `context` parameter type and meta assembly:

```ts
  context: {
    tenant: string;
    authKind: string;
    siteCode?: string | null;
    language?: string | null;
  },
): readonly ["emporix", string, ...TArgs, Record<string, unknown>] {
  const meta: Record<string, unknown> = {
    tenant: context.tenant,
    authKind: context.authKind,
  };
  if (context.siteCode !== undefined) {
    meta.siteCode = context.siteCode;
  }
  if (context.language !== undefined) {
    meta.language = context.language;
  }
  return ["emporix", resource, ...args, meta] as const;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS (the new field is optional; existing callers omit it → dropped from meta).

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/hooks/internal/query-keys.ts
git commit -m "feat(react): add language dimension to emporixKey" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: React — thread `language` into products / categories / variant-children

**Files:**
- Modify: `packages/react/src/hooks/use-products.ts`, `src/hooks/use-categories.ts`, `src/hooks/use-variant-children.ts`

These all use the pattern `const { siteCode } = useReadSite();` + `emporixKey(resource, args, { tenant: client.tenant, authKind: ctx.kind, siteCode })`. Add `language` to both.

- [ ] **Step 1: `use-products.ts`**

In `packages/react/src/hooks/use-products.ts`, change every `const { siteCode } = useReadSite();` to:

```ts
  const { siteCode, language } = useReadSite();
```

(there are 7 occurrences — one per exported hook). Then add `language` to each `emporixKey(...)` context object — change every `{ tenant: client.tenant, authKind: ctx.kind, siteCode }` to:

```ts
{ tenant: client.tenant, authKind: ctx.kind, siteCode, language }
```

For `useProductsByCodes`, the context object is multi-line; update it to:

```ts
    queryKey: emporixKey("products-by-codes", [codes, options.chunkSize], {
      tenant: client.tenant,
      authKind: ctx.kind,
      siteCode,
      language,
    }),
```

- [ ] **Step 2: `use-categories.ts`**

Same two edits: change all four `const { siteCode } = useReadSite();` to `const { siteCode, language } = useReadSite();`, and append `, language` to each of the four `{ tenant: client.tenant, authKind: ctx.kind, siteCode }` context objects (resources `"category"`, `"subcategories"`, `"categories"`, `"categories-infinite"`).

- [ ] **Step 3: `use-variant-children.ts`**

Change `const { siteCode } = useReadSite();` to `const { siteCode, language } = useReadSite();`, and the context object to:

```ts
      { tenant: client.tenant, authKind: ctx.kind, siteCode, language },
```

- [ ] **Step 4: Verify typecheck + existing tests pass**

Run: `pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-products.test.tsx tests/use-categories.test.tsx`
Expected: PASS (if a listed test file does not exist, run `pnpm -F @viu/emporix-sdk-react test` instead).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-products.ts packages/react/src/hooks/use-categories.ts packages/react/src/hooks/use-variant-children.ts
git commit -m "feat(react): key products/categories reads by language" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: React — thread `language` into cart + shopping-lists

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts`, `src/hooks/use-shopping-lists.ts`

- [ ] **Step 1: `use-cart.ts` — `useCart`**

In `useCart`, change `const { siteCode } = useReadSite();` to `const { siteCode, language } = useReadSite();` and the key context to:

```ts
    queryKey: emporixKey(
      "cart",
      [resolvedId ?? null, activeCompany?.id ?? null],
      { tenant: client.tenant, authKind: ctx.kind, siteCode, language },
    ),
```

- [ ] **Step 2: `use-cart.ts` — `useCartMutations`**

In `useCartMutations`, change `const { siteCode } = useReadSite();` to `const { siteCode, language } = useReadSite();` and update the `keyFor` helper so its cache key matches `useCart` (otherwise optimistic updates would write to a different key after the language dimension is added):

```ts
  const keyFor = (id: string) =>
    emporixKey(
      "cart",
      [id, activeCompany?.id ?? null],
      { tenant: client.tenant, authKind: ctx.kind, siteCode, language },
    );
```

- [ ] **Step 3: `use-shopping-lists.ts`**

Change `const { siteCode } = useReadSite();` to `const { siteCode, language } = useReadSite();` and the key to:

```ts
    queryKey: emporixKey("shopping-lists", [opts.name ?? null], { tenant: client.tenant, authKind: ctx.kind, siteCode, language }),
```

- [ ] **Step 4: Verify typecheck + cart tests pass**

Run: `pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-cart.test.tsx`
Expected: PASS (if the file name differs, run `pnpm -F @viu/emporix-sdk-react test`).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/src/hooks/use-shopping-lists.ts
git commit -m "feat(react): key cart + shopping-list reads by language" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: React — thread `language` into my-segments (raw inline keys)

**Files:**
- Modify: `packages/react/src/hooks/use-my-segments.ts`

This file builds raw keys like `["emporix", "segment", "list", { tenant: client.tenant, query, siteCode }]` (NOT via `emporixKey`). Add `language` to each meta object. There are 7 hooks; each already has `const { siteCode } = useReadSite();`.

- [ ] **Step 1: Add `language` to every `useReadSite` destructure**

Change all 7 `const { siteCode } = useReadSite();` to:

```ts
  const { siteCode, language } = useReadSite();
```

- [ ] **Step 2: Add `language` to every key meta object**

Update each of the 7 query keys' trailing meta object from `{ tenant: client.tenant, query, siteCode }` to `{ tenant: client.tenant, query, siteCode, language }`. The exact keys to update (by resource string):
- `["emporix", "segment", "list", { … }]`
- `["emporix", "segment", "items", { … }]`
- `["emporix", "segment", "categoryTree", { … }]`
- `["emporix", "segment", "myProducts", { … }]`
- `["emporix", "myProductsInfinite", { … }]`
- `["emporix", "segment", "myCategories", { … }]`
- `["emporix", "myCategoriesInfinite", { … }]`

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/hooks/use-my-segments.ts
git commit -m "feat(react): key segment reads by language" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: React — thread `language` into order hooks

**Files:**
- Modify: `packages/react/src/hooks/use-my-orders.ts`, `src/hooks/use-my-orders-infinite.ts`, `src/hooks/use-order.ts`, `src/hooks/use-sales-order.ts`

`use-my-orders` and `use-my-orders-infinite` already call `useReadSite()` and pass `siteCode`. `use-order` and `use-sales-order` do NOT call `useReadSite()` yet.

- [ ] **Step 1: `use-my-orders.ts`**

Change `const { siteCode } = useReadSite();` to `const { siteCode, language } = useReadSite();`. Update the key context (the `emporixKey("orders", [...], { … })` third arg) to:

```ts
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous", siteCode, language },
```

- [ ] **Step 2: `use-my-orders-infinite.ts`**

Same: `const { siteCode, language } = useReadSite();` and update the `emporixKey("orders", [...], { … })` third arg to:

```ts
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous", siteCode, language },
```

- [ ] **Step 3: `use-order.ts` — add `useReadSite` + language**

Add the import at the top:

```ts
import { useReadSite } from "./internal/use-read-site";
```

Inside `useOrder`, after `const token = storage.getCustomerToken();` add:

```ts
  const { language } = useReadSite();
```

Update the key:

```ts
    queryKey: emporixKey("orders", [orderId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
      language,
    }),
```

- [ ] **Step 4: `use-sales-order.ts` — add `useReadSite` + language**

Add the import at the top:

```ts
import { useReadSite } from "./internal/use-read-site";
```

Inside `useSalesOrder`, after `const { client } = useEmporix();` add:

```ts
  const { language } = useReadSite();
```

Update the key:

```ts
    queryKey: emporixKey("salesorders", [orderId ?? null], {
      tenant: client.tenant,
      authKind: authCtx?.kind ?? "anonymous",
      language,
    }),
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-my-orders.ts packages/react/src/hooks/use-my-orders-infinite.ts packages/react/src/hooks/use-order.ts packages/react/src/hooks/use-sales-order.ts
git commit -m "feat(react): key order reads by language" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: React — representative query-key language test

**Files:**
- Test: `packages/react/tests/use-language-keys.test.tsx`

Prove that two languages produce two distinct cache entries for a localized hook, and that the active language reaches the request as `Accept-Language`.

- [ ] **Step 1: Write the test**

Create `packages/react/tests/use-language-keys.test.tsx`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useProducts } from "../src/hooks/use-products";
import type { ReactNode } from "react";

const seenLanguages: string[] = [];
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
    const lang = request.headers.get("accept-language");
    if (lang) seenLanguages.push(lang);
    return HttpResponse.json([], { headers: { "X-Total-Count": "0" } });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenLanguages.length = 0;
});
afterAll(() => server.close());

function wrapper(initialLanguage: string) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient} initialLanguage={initialLanguage}>
      {children}
    </EmporixProvider>
  );
}

describe("language reaches localized product reads", () => {
  it("sends the active language as Accept-Language", async () => {
    const { result } = renderHook(() => useProducts(), { wrapper: wrapper("de") });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenLanguages).toContain("de");
  });
});
```

Note: `client.products.list` GETs `/product/{tenant}/products` (verified in `packages/sdk/src/services/product.ts:40`), hence the MSW path above.

- [ ] **Step 2: Run the test**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-language-keys.test.tsx`
Expected: PASS — `seenLanguages` contains `"de"`.

- [ ] **Step 3: Commit**

```bash
git add packages/react/tests/use-language-keys.test.tsx
git commit -m "test(react): assert active language reaches localized reads" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Example — `LanguageSwitcher` + Header wiring

**Files:**
- Create: `examples/storefront-demo/src/app/LanguageSwitcher.tsx`
- Modify: `examples/storefront-demo/src/app/Header.tsx`

Requires the built `dist/` of both packages (examples typecheck against `dist/`). Build first.

- [ ] **Step 1: Build the packages**

Run: `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build`
Expected: both `dist/` written, no errors.

- [ ] **Step 2: Create `LanguageSwitcher.tsx`**

Create `examples/storefront-demo/src/app/LanguageSwitcher.tsx`:

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

export function LanguageSwitcher() {
  const { siteCode, language, setLanguage } = useSiteContext();
  const { data: sites } = useSites();
  const activeSite = sites?.find((s) => s.code === siteCode);
  const languages =
    activeSite?.languages && activeSite.languages.length > 0
      ? activeSite.languages
      : language
        ? [language]
        : [];
  if (languages.length <= 1) return null;
  return (
    <select
      aria-label="Language"
      value={language ?? ""}
      onChange={(e) => void setLanguage(e.target.value)}
      className="field__control"
      style={selectStyle}
    >
      {languages.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Mount it in the Header**

In `examples/storefront-demo/src/app/Header.tsx`, add the import next to the existing `SiteCurrencySwitcher` import:

```ts
import { SiteCurrencySwitcher } from "./SiteCurrencySwitcher";
import { LanguageSwitcher } from "./LanguageSwitcher";
```

And render `<LanguageSwitcher />` immediately next to the existing `<SiteCurrencySwitcher />` (same parent cluster):

```tsx
        <LanguageSwitcher />
        <SiteCurrencySwitcher />
```

(No `adapters.ts` change is required: with `Accept-Language`, the API returns localized fields as strings, so `pickText` returns them directly; `localized()` / `LOCALE_ORDER` remain only as a fallback.)

- [ ] **Step 4: Verify the example typechecks**

Run: `pnpm -F @viu/emporix-examples-storefront-demo typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/storefront-demo/src/app/LanguageSwitcher.tsx examples/storefront-demo/src/app/Header.tsx
git commit -m "feat(examples): add LanguageSwitcher to storefront-demo header" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Changeset + full verification

**Files:**
- Create: `.changeset/language-switch.md`

- [ ] **Step 1: Author the changeset**

Create `.changeset/language-switch.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add a runtime language switch. `client.setStorefrontContext({ language })` now sets an `Accept-Language` header on every read. React's `useSiteContext()` exposes `language` + `setLanguage(lang)` (modeled on `setCurrency`), persists the choice via `EmporixStorage` (`emporix.language`), mirrors it into the server session context, and keys localized reads (products, categories, segments, cart, shopping lists, orders) by language so the cache never serves stale-language text. A new `initialLanguage` provider prop seeds the active language.
```

- [ ] **Step 2: Full repo verification**

Run: `pnpm -r build && pnpm typecheck && pnpm -r test`
Expected: all packages build, typecheck clean, all unit tests pass.

- [ ] **Step 3: Commit**

```bash
git add .changeset/language-switch.md
git commit -m "chore(release): add language-switch changeset" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done

All tasks complete: the SDK sends `Accept-Language` from a shared request context, React exposes `language` + `setLanguage` with persistence and session-context sync, localized reads are language-keyed, and the storefront-demo has a working `LanguageSwitcher`. Open a PR against `main` from `feat/language-switch` when ready.
