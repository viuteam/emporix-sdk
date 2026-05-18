# Emporix SDK — Plan 3: React Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@viu/emporix-sdk-react` — provider, pluggable token storage, customer-session hook, query hooks, cart mutation hooks with optimistic updates, error helpers, SSR helpers — on top of the published core SDK, with subpath exports.

**Architecture:** Thin wrappers over `@tanstack/react-query` v5. Core SDK has zero React dependency; React lives only here. `react` + `@tanstack/react-query` are peer deps (React 18 + 19). One `EmporixClient` is created by the consumer and passed to `EmporixProvider`; customer tokens flow through pluggable `TokenStorage` and are turned into per-call `AuthContext` at the hook boundary (SSR-safe, never stored on the client).

**Tech Stack:** React 18 (peer range 18||19), `@tanstack/react-query` ^5, `@viu/emporix-sdk` (workspace), tsup multi-entry, vitest + `@testing-library/react` + jsdom, msw.

**Spec:** `docs/superpowers/specs/2026-05-17-emporix-sdk-design.md` §3.6, §12; milestones 10–14.

**Prerequisite core change:** `EmporixClient` must expose `readonly tenant` (query keys are namespaced by tenant). Added in Task 2 — a minimal, additive change to `packages/sdk`.

**Test resolution note:** shipped React code imports the package name `@viu/emporix-sdk` only (never `packages/sdk/src/**`, per spec). The react vitest config adds a **test-only** alias `@viu/emporix-sdk` → `../sdk/src/index.ts` so tests don't require a prior build. This alias is test-scoped; build/runtime resolve the real package.

---

## File Structure (this plan)

```
packages/sdk/src/client.ts               + readonly tenant (prerequisite)
packages/react/package.json              @viu/emporix-sdk-react, peer deps, subpath exports
packages/react/tsconfig.json packages/react/tsup.config.ts
packages/react/vitest.config.ts          jsdom + test alias to sdk src
packages/react/vitest.setup.ts           @testing-library/jest-dom
packages/react/eslint.config.js          react-hooks rules, no-console
packages/react/src/provider.tsx          EmporixProvider + useEmporix context
packages/react/src/storage/memory.ts     createMemoryStorage (default, SSR-safe)
packages/react/src/storage/local-storage.ts  createLocalStorageStorage
packages/react/src/storage/cookie.ts     createCookieStorage
packages/react/src/storage/index.ts      TokenStorage type + re-exports
packages/react/src/hooks/use-customer-session.ts
packages/react/src/hooks/queries.ts      useProduct/useProducts/useProductsInfinite/useCategory/useCategories/useCategoryTree/useCart
packages/react/src/hooks/use-cart-mutations.ts
packages/react/src/hooks/index.ts
packages/react/src/errors.tsx            EmporixErrorBoundary + useEmporixErrorHandler
packages/react/src/ssr.ts                prefetch/dehydrate helpers
packages/react/src/index.ts              public exports
packages/react/tests/**                  one test file per unit
.changeset/react-package.md
```

Each hook file is single-responsibility. Storage adapters are isolated and independently tested. Provider holds only context wiring.

---

## Task 1: React package scaffold

**Files:**
- Create: `packages/react/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `eslint.config.js`, `src/index.ts` (placeholder)

- [ ] **Step 1: Create `packages/react/package.json`**

```json
{
  "name": "@viu/emporix-sdk-react",
  "version": "0.0.0",
  "description": "React bindings for the Emporix SDK",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=18" },
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" },
    "./provider": { "import": "./dist/provider.js", "require": "./dist/provider.cjs", "types": "./dist/provider.d.ts" },
    "./hooks": { "import": "./dist/hooks.js", "require": "./dist/hooks.cjs", "types": "./dist/hooks.d.ts" },
    "./storage": { "import": "./dist/storage.js", "require": "./dist/storage.cjs", "types": "./dist/storage.d.ts" },
    "./ssr": { "import": "./dist/ssr.js", "require": "./dist/ssr.cjs", "types": "./dist/ssr.d.ts" }
  },
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": {
    "build": "tsup",
    "test": "vitest run --coverage",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@viu/emporix-sdk": "workspace:^",
    "@tanstack/react-query": "^5.0.0",
    "react": "^18.0.0 || ^19.0.0"
  },
  "devDependencies": {
    "@tanstack/react-query": "^5.51.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@viu/emporix-sdk": "workspace:*",
    "@vitejs/plugin-react": "^4.3.0",
    "@vitest/coverage-v8": "^2.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "jsdom": "^25.0.0",
    "msw": "^2.4.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tsup": "^8.2.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/react/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `packages/react/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/provider.tsx",
    "src/hooks/index.ts",
    "src/storage/index.ts",
    "src/ssr.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom", "@tanstack/react-query", "@viu/emporix-sdk"],
});
```

> Note: tsup writes `src/hooks/index.ts` → `dist/hooks.js` and
> `src/storage/index.ts` → `dist/storage.js` (basename collision avoided
> because each is the sole `index` in its dir; if tsup emits `hooks/index.js`,
> adjust the package.json `exports` paths to match the actual emitted files in
> Task 8 Step 4).

- [ ] **Step 4: Create `packages/react/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Test-only: resolve the package to sdk source so tests need no prebuild.
      // Shipped code still imports the package name (see plan header).
      "@viu/emporix-sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/hooks/index.ts", "src/storage/index.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

- [ ] **Step 5: Create `packages/react/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Create `packages/react/eslint.config.js`**

```js
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tsparser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "@typescript-eslint": tseslint, "react-hooks": reactHooks },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "No default exports — use named exports." }
      ]
    }
  }
];
```

- [ ] **Step 7: Create placeholder `packages/react/src/index.ts`**

```ts
// Public exports are populated as units land (final task of this plan).
export {};
```

- [ ] **Step 8: Install, typecheck, lint, build**

Run: `pnpm install`
Run: `pnpm --filter @viu/emporix-sdk-react typecheck`
Expected: PASS.
Run: `pnpm --filter @viu/emporix-sdk-react lint`
Expected: PASS.
Run: `pnpm --filter @viu/emporix-sdk build && pnpm --filter @viu/emporix-sdk-react build`
Expected: react `dist/index.js` etc. emitted (sdk built first so the workspace peer resolves).

- [ ] **Step 9: Commit**

```bash
git add packages/react pnpm-lock.yaml
git commit -m "chore(react): scaffold @viu/emporix-sdk-react package"
```

---

## Task 2: Expose tenant on EmporixClient + Provider + memory storage

**Files:**
- Modify: `packages/sdk/src/client.ts` (add `readonly tenant`)
- Create: `packages/react/src/storage/memory.ts`, `packages/react/src/storage/index.ts`, `packages/react/src/provider.tsx`
- Test: `packages/react/tests/provider.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, useEmporix } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";

function mkClient() {
  return new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
}

describe("EmporixProvider", () => {
  it("useEmporix throws when no provider is present", () => {
    expect(() => renderHook(() => useEmporix())).toThrow(/EmporixProvider/);
  });

  it("exposes client + storage and renders children", () => {
    const client = mkClient();
    const storage = createMemoryStorage({ initial: "tok-1" });
    const { result } = renderHook(() => useEmporix(), {
      wrapper: ({ children }) => (
        <EmporixProvider client={client} storage={storage}>{children}</EmporixProvider>
      ),
    });
    expect(result.current.client).toBe(client);
    expect(result.current.storage.getCustomerToken()).toBe("tok-1");
    expect(client.tenant).toBe("acme");
  });

  it("renders a child tree", () => {
    render(
      <EmporixProvider client={mkClient()}>
        <span>hello</span>
      </EmporixProvider>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("memory storage notifies subscribers", () => {
    const s = createMemoryStorage();
    const seen: (string | null)[] = [];
    const unsub = s.subscribe!((t) => seen.push(t));
    s.setCustomerToken("x");
    s.setCustomerToken(null);
    unsub();
    s.setCustomerToken("y");
    expect(seen).toEqual(["x", null]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/provider.test.tsx`
Expected: FAIL — `client.tenant` undefined / modules missing.

- [ ] **Step 3: Add `readonly tenant` to `packages/sdk/src/client.ts`**

In the class body add the field declaration alongside the service fields:

```ts
  readonly tenant: string;
```

And in the constructor, after `const cfg = validateConfig(config);`, add:

```ts
    this.tenant = cfg.tenant;
```

- [ ] **Step 4: Create `packages/react/src/storage/index.ts`**

```ts
/** Pluggable customer-token store. SSR-safe by default (memory). */
export interface TokenStorage {
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;
}

export { createMemoryStorage } from "./memory";
```

- [ ] **Step 5: Create `packages/react/src/storage/memory.ts`**

```ts
import type { TokenStorage } from "./index";

/** In-memory token store. Default, SSR-safe, no persistence. */
export function createMemoryStorage(opts: { initial?: string } = {}): TokenStorage {
  let token: string | null = opts.initial ?? null;
  const listeners = new Set<(t: string | null) => void>();
  return {
    getCustomerToken: () => token,
    setCustomerToken: (t) => {
      token = t;
      for (const l of listeners) l(token);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
```

- [ ] **Step 6: Create `packages/react/src/provider.tsx`**

```tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { TokenStorage } from "./storage/index";
import { createMemoryStorage } from "./storage/memory";

interface EmporixContextValue {
  client: EmporixClient;
  storage: TokenStorage;
}

const EmporixContext = createContext<EmporixContextValue | null>(null);

/** Props for {@link EmporixProvider}. */
export interface EmporixProviderProps {
  client: EmporixClient;
  queryClient?: QueryClient;
  storage?: TokenStorage;
  initialCustomerToken?: string;
  children: ReactNode;
}

/** Provides the SDK client, token storage and a react-query client to the tree. */
export function EmporixProvider({
  client,
  queryClient,
  storage,
  initialCustomerToken,
  children,
}: EmporixProviderProps): React.JSX.Element {
  const value = useMemo<EmporixContextValue>(() => {
    const s = storage ?? createMemoryStorage({ initial: initialCustomerToken });
    if (initialCustomerToken && storage && storage.getCustomerToken() === null) {
      storage.setCustomerToken(initialCustomerToken);
    }
    return { client, storage: s };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, storage, initialCustomerToken]);
  const qc = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);
  return (
    <EmporixContext.Provider value={value}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </EmporixContext.Provider>
  );
}

/** Returns the SDK client and token storage. Throws outside an {@link EmporixProvider}. */
export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
```

- [ ] **Step 4 check / Step 7: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/provider.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/client.ts packages/react/src/provider.tsx packages/react/src/storage packages/react/tests/provider.test.tsx
git commit -m "feat(react): add EmporixProvider, useEmporix and memory storage"
```

---

## Task 3: localStorage + cookie storage adapters

**Files:**
- Create: `packages/react/src/storage/local-storage.ts`, `packages/react/src/storage/cookie.ts`
- Modify: `packages/react/src/storage/index.ts` (re-export)
- Test: `packages/react/tests/storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createLocalStorageStorage } from "../src/storage/local-storage";
import { createCookieStorage } from "../src/storage/cookie";

describe("localStorage storage", () => {
  beforeEach(() => localStorage.clear());

  it("persists and clears the token", () => {
    const s = createLocalStorageStorage();
    expect(s.getCustomerToken()).toBeNull();
    s.setCustomerToken("abc");
    expect(localStorage.getItem("emporix.customerToken")).toBe("abc");
    expect(createLocalStorageStorage().getCustomerToken()).toBe("abc");
    s.setCustomerToken(null);
    expect(localStorage.getItem("emporix.customerToken")).toBeNull();
  });

  it("uses a custom key", () => {
    createLocalStorageStorage({ key: "k" }).setCustomerToken("z");
    expect(localStorage.getItem("k")).toBe("z");
  });

  it("falls back to memory + warns once when localStorage is unavailable", () => {
    const orig = globalThis.localStorage;
    // @ts-expect-error force unavailable
    delete (globalThis as { localStorage?: unknown }).localStorage;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = createLocalStorageStorage();
    s.setCustomerToken("mem");
    expect(s.getCustomerToken()).toBe("mem");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    Object.defineProperty(globalThis, "localStorage", { value: orig, configurable: true });
  });
});

describe("cookie storage", () => {
  beforeEach(() => {
    document.cookie = "emporix.customerToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("reads and writes a cookie with attributes", () => {
    const s = createCookieStorage({ sameSite: "strict", secure: true });
    expect(s.getCustomerToken()).toBeNull();
    s.setCustomerToken("ck");
    expect(document.cookie).toContain("emporix.customerToken=ck");
    expect(s.getCustomerToken()).toBe("ck");
    s.setCustomerToken(null);
    expect(s.getCustomerToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/storage.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Create `packages/react/src/storage/local-storage.ts`**

```ts
import type { TokenStorage } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_KEY = "emporix.customerToken";

/** Browser `localStorage`-backed store. Falls back to memory on the server. */
export function createLocalStorageStorage(opts: { key?: string } = {}): TokenStorage {
  const key = opts.key ?? DEFAULT_KEY;
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] localStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  const ls = (globalThis as unknown as { localStorage: Storage }).localStorage;
  const listeners = new Set<(t: string | null) => void>();
  return {
    getCustomerToken: () => ls.getItem(key),
    setCustomerToken: (t) => {
      if (t === null) ls.removeItem(key);
      else ls.setItem(key, t);
      for (const l of listeners) l(t);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
```

- [ ] **Step 4: Create `packages/react/src/storage/cookie.ts`**

```ts
import type { TokenStorage } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_NAME = "emporix.customerToken";

/** Cookie-backed store. Consumer must set SameSite/Secure for CSRF safety. */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): TokenStorage {
  const name = opts.name ?? DEFAULT_NAME;
  const sameSite = opts.sameSite ?? "lax";
  const secure = opts.secure ?? false;
  if (typeof document === "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[emporix] document unavailable; cookie storage falling back to in-memory");
    return createMemoryStorage();
  }
  const read = (): string | null => {
    for (const part of document.cookie.split("; ")) {
      const [k, ...v] = part.split("=");
      if (k === name) return decodeURIComponent(v.join("=")) || null;
    }
    return null;
  };
  return {
    getCustomerToken: read,
    setCustomerToken: (t) => {
      const attrs = `path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
      document.cookie =
        t === null
          ? `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attrs}`
          : `${name}=${encodeURIComponent(t)}; ${attrs}`;
    },
  };
}
```

- [ ] **Step 5: Re-export from `packages/react/src/storage/index.ts`**

Append:

```ts
export { createLocalStorageStorage } from "./local-storage";
export { createCookieStorage } from "./cookie";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/storage.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/storage packages/react/tests/storage.test.ts
git commit -m "feat(react): add localStorage and cookie storage adapters"
```

---

## Task 4: useCustomerSession

**Files:**
- Create: `packages/react/src/hooks/use-customer-session.ts`, `packages/react/src/hooks/index.ts`
- Test: `packages/react/tests/use-customer-session.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCustomerSession } from "../src/hooks/use-customer-session";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/customer/acme/login", () =>
    HttpResponse.json({ accessToken: "cust", saasToken: "saas", refreshToken: "crt" }),
  ),
  http.get("https://api.emporix.io/customer/acme/me", () =>
    HttpResponse.json({ id: "c1", email: "a@b.co" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useCustomerSession", () => {
  it("starts unauthenticated", () => {
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper() });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.customerToken).toBeNull();
  });

  it("login stores the token and fetches the customer", async () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "p" });
    });
    expect(storage.getCustomerToken()).toBe("cust");
    expect(result.current.isAuthenticated).toBe(true);
    await waitFor(() => expect(result.current.customer?.email).toBe("a@b.co"));
  });

  it("logout clears the token", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    expect(result.current.isAuthenticated).toBe(true);
    act(() => result.current.logout());
    expect(storage.getCustomerToken()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/use-customer-session.test.tsx`
Expected: FAIL — hook module missing.

- [ ] **Step 3: Create `packages/react/src/hooks/use-customer-session.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { auth, type Customer } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/** Customer authentication state and actions. */
export interface CustomerSessionApi {
  customerToken: string | null;
  customer: Customer | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  signup: (input: { email: string; password: string }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

/** Manages the customer session: login/signup/logout and the `me` query. */
export function useCustomerSession(): CustomerSessionApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => storage.getCustomerToken());

  useEffect(() => {
    return storage.subscribe?.((t) => setToken(t));
  }, [storage]);

  const meQuery = useQuery({
    queryKey: ["emporix", "customer", "me", { tenant: client.tenant, hasToken: token !== null }],
    enabled: token !== null,
    queryFn: () => client.customers.me(auth.customer(token as string)),
  });

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const session = await client.customers.login(input);
      storage.setCustomerToken(session.customerToken);
      setToken(session.customerToken);
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
    },
    [client, storage, qc],
  );

  const signup = useCallback(
    async (input: { email: string; password: string }) => {
      await client.customers.signup(input);
    },
    [client],
  );

  const logout = useCallback(() => {
    storage.setCustomerToken(null);
    setToken(null);
    qc.removeQueries({ queryKey: ["emporix", "customer"] });
    qc.removeQueries({ queryKey: ["emporix", "cart"] });
  }, [storage, qc]);

  const refresh = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  return {
    customerToken: token,
    customer: meQuery.data ?? null,
    isAuthenticated: token !== null,
    isLoading: meQuery.isLoading && token !== null,
    login,
    signup,
    logout,
    refresh,
  };
}
```

- [ ] **Step 4: Create `packages/react/src/hooks/index.ts`**

```ts
export { useCustomerSession } from "./use-customer-session";
export type { CustomerSessionApi } from "./use-customer-session";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/use-customer-session.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks packages/react/tests/use-customer-session.test.tsx
git commit -m "feat(react): add useCustomerSession hook"
```

---

## Task 5: Query hooks

**Files:**
- Create: `packages/react/src/hooks/queries.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Test: `packages/react/tests/queries.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useProduct, useCategory, useCart } from "../src/hooks/queries";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
  http.get("https://api.emporix.io/category/acme/categories/c1", () =>
    HttpResponse.json({ id: "c1", name: "Books" }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("query hooks", () => {
  it("useProduct fetches anonymously by default", async () => {
    const { result } = renderHook(() => useProduct("p1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.name).toBe("Widget"));
  });

  it("useCategory fetches a category", async () => {
    const { result } = renderHook(() => useCategory("c1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.name).toBe("Books"));
  });

  it("useCart is disabled without a cartId", async () => {
    const { result } = renderHook(() => useCart(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useCart uses customer auth when a token is stored", async () => {
    const storage = createMemoryStorage({ initial: "cust-tok" });
    const { result } = renderHook(() => useCart("cart1"), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.data?.id).toBe("cart1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/queries.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `packages/react/src/hooks/queries.ts`**

```ts
import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Product,
  type Category,
  type CategoryNode,
  type Cart,
  type Page,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

interface QueryOpts {
  auth?: AuthContext;
}

function useReadAuth(override?: AuthContext): { ctx: AuthContext; kind: string } {
  const { storage } = useEmporix();
  if (override) return { ctx: override, kind: override.kind };
  const token = storage.getCustomerToken();
  return token
    ? { ctx: auth.customer(token), kind: "customer" }
    : { ctx: auth.anonymous(), kind: "anonymous" };
}

/** Fetches one product. Default auth: customer if logged in, else anonymous. */
export function useProduct(
  productId: string,
  options: QueryOpts = {},
): UseQueryResult<Product> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "product", productId, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.products.get(productId, undefined, ctx),
  });
}

/** Fetches one page of products. */
export function useProducts(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<Page<Product>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.products.list(params, ctx),
  });
}

/** Infinite product list keyed by page number. */
export function useProductsInfinite(
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: Page<Product>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useInfiniteQuery({
    queryKey: ["emporix", "products-infinite", params, { tenant: client.tenant, authKind: kind }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.products.list({ pageNumber: pageParam, pageSize: params.pageSize }, ctx),
    getNextPageParam: (last, all) =>
      last.items.length === 0 ? undefined : all.length + 1,
  });
}

/** Fetches one category. */
export function useCategory(
  categoryId: string,
  options: QueryOpts = {},
): UseQueryResult<Category> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "category", categoryId, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.categories.get(categoryId, ctx),
  });
}

/** Fetches one page of categories. */
export function useCategories(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<Page<Category>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "categories", params, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.categories.list(params, ctx),
  });
}

/** Fetches the category tree. */
export function useCategoryTree(
  rootId?: string,
  options: QueryOpts = {},
): UseQueryResult<CategoryNode> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "category-tree", rootId ?? null, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.categories.tree(rootId, ctx),
  });
}

/** Fetches a cart by id. Disabled when `cartId` is undefined. */
export function useCart(
  cartId?: string,
  options: QueryOpts = {},
): UseQueryResult<Cart> {
  const { client, storage } = useEmporix();
  const override = options.auth;
  const token = storage.getCustomerToken();
  const ctx: AuthContext = override ?? (token ? auth.customer(token) : auth.anonymous());
  return useQuery({
    queryKey: ["emporix", "cart", cartId ?? null, { tenant: client.tenant, authKind: ctx.kind }],
    enabled: cartId !== undefined,
    queryFn: () => client.carts.get(cartId as string, ctx),
  });
}
```

- [ ] **Step 4: Re-export from `packages/react/src/hooks/index.ts`**

Append:

```ts
export {
  useProduct, useProducts, useProductsInfinite,
  useCategory, useCategories, useCategoryTree, useCart,
} from "./queries";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/queries.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks packages/react/tests/queries.test.tsx
git commit -m "feat(react): add product/category/cart query hooks"
```

---

## Task 6: useCartMutations (optimistic + rollback)

**Files:**
- Create: `packages/react/src/hooks/use-cart-mutations.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Test: `packages/react/tests/use-cart-mutations.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCart } from "../src/hooks/queries";
import { useCartMutations } from "../src/hooks/use-cart-mutations";
import type { ReactNode } from "react";

let addShouldFail = false;
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.post("https://api.emporix.io/cart/acme/carts/cart1/items", () =>
    addShouldFail
      ? HttpResponse.json({ message: "no" }, { status: 422 })
      : HttpResponse.json({ id: "cart1", items: [{ id: "i1", productId: "p1" }] }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  addShouldFail = false;
});
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useCartMutations", () => {
  it("addItem updates the cart cache", async () => {
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.id).toBe("cart1"));
    await act(async () => {
      await result.current.mut.addItem.mutateAsync({ productId: "p1", quantity: 1 });
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(1));
  });

  it("rolls back the optimistic update on error", async () => {
    addShouldFail = true;
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(0));
    await act(async () => {
      await result.current.mut.addItem
        .mutateAsync({ productId: "p1", quantity: 1 })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/use-cart-mutations.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `packages/react/src/hooks/use-cart-mutations.ts`**

```ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Cart, type CartAddress } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

type Mut<TVars> = UseMutationResult<Cart, unknown, TVars, { previous: Cart | undefined }>;

/** Cart write operations with optimistic cache updates and rollback. */
export interface CartMutationsApi {
  addItem: Mut<{ productId: string; quantity: number }>;
  updateItem: Mut<{ itemId: string; quantity: number }>;
  removeItem: Mut<{ itemId: string }>;
  clear: Mut<void>;
  applyCoupon: Mut<{ code: string }>;
  removeCoupon: Mut<{ code: string }>;
  setShippingAddress: Mut<CartAddress>;
  setBillingAddress: Mut<CartAddress>;
}

/** Returns mutation handles for a cart, each optimistically patching `useCart`. */
export function useCartMutations(cartId: string): CartMutationsApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const token = storage.getCustomerToken();
  const ctx: AuthContext = token ? auth.customer(token) : auth.anonymous();
  const key = ["emporix", "cart", cartId, { tenant: client.tenant, authKind: ctx.kind }];

  function make<TVars>(
    run: (vars: TVars) => Promise<Cart>,
    optimistic?: (prev: Cart | undefined, vars: TVars) => Cart | undefined,
  ): Mut<TVars> {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMutation<Cart, unknown, TVars, { previous: Cart | undefined }>({
      mutationFn: run,
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Cart>(key);
        if (optimistic) qc.setQueryData<Cart>(key, optimistic(previous, vars));
        return { previous };
      },
      onError: (_e, _v, c) => {
        if (c) qc.setQueryData(key, c.previous);
      },
      onSuccess: (cart) => qc.setQueryData(key, cart),
    });
  }

  return {
    addItem: make(
      (v) => client.carts.addItem(cartId, v, ctx),
      (prev, v) =>
        prev
          ? { ...prev, items: [...prev.items, { id: `optimistic-${v.productId}`, ...v }] }
          : prev,
    ),
    updateItem: make((v) =>
      client.carts.updateItem(cartId, v.itemId, { quantity: v.quantity }, ctx),
    ),
    removeItem: make(
      (v) => client.carts.removeItem(cartId, v.itemId, ctx),
      (prev, v) =>
        prev ? { ...prev, items: prev.items.filter((i) => i.id !== v.itemId) } : prev,
    ),
    clear: make(
      () => client.carts.clear(cartId, ctx),
      (prev) => (prev ? { ...prev, items: [] } : prev),
    ),
    applyCoupon: make((v) => client.carts.applyCoupon(cartId, v.code, ctx)),
    removeCoupon: make((v) => client.carts.removeCoupon(cartId, v.code, ctx)),
    setShippingAddress: make((v) => client.carts.setShippingAddress(cartId, v, ctx)),
    setBillingAddress: make((v) => client.carts.setBillingAddress(cartId, v, ctx)),
  };
}
```

> Note: `make` calls `useMutation` in a fixed order every render (8 calls, no
> conditionals/loops), so the rules-of-hooks inline-disable is safe — the call
> order is stable. Tests assert this stability via repeated renders.

- [ ] **Step 4: Re-export from `packages/react/src/hooks/index.ts`**

Append:

```ts
export { useCartMutations } from "./use-cart-mutations";
export type { CartMutationsApi } from "./use-cart-mutations";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/use-cart-mutations.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks packages/react/tests/use-cart-mutations.test.tsx
git commit -m "feat(react): add useCartMutations with optimistic updates"
```

---

## Task 7: Error boundary + useEmporixErrorHandler

**Files:**
- Create: `packages/react/src/errors.tsx`
- Test: `packages/react/tests/errors.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmporixErrorBoundary } from "../src/errors";

function Boom(): React.JSX.Element {
  throw new Error("kaboom");
}

describe("EmporixErrorBoundary", () => {
  it("renders fallback on error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EmporixErrorBoundary fallback={<span>failed</span>}>
        <Boom />
      </EmporixErrorBoundary>,
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <EmporixErrorBoundary fallback={<span>failed</span>}>
        <span>ok</span>
      </EmporixErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/errors.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `packages/react/src/errors.tsx`**

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { EmporixError, EmporixAuthError } from "@viu/emporix-sdk";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}
interface State {
  error: Error | null;
}

/** Catches render errors (including thrown {@link EmporixError}) and shows a fallback. */
export class EmporixErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

/** Returns a handler that runs `onAuthError` for {@link EmporixAuthError}, else `onError`. */
export function useEmporixErrorHandler(handlers: {
  onAuthError?: (e: EmporixAuthError) => void;
  onError?: (e: EmporixError) => void;
}): (error: unknown) => void {
  return (error: unknown) => {
    if (error instanceof EmporixAuthError) handlers.onAuthError?.(error);
    else if (error instanceof EmporixError) handlers.onError?.(error);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/errors.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/errors.tsx packages/react/tests/errors.test.tsx
git commit -m "feat(react): add EmporixErrorBoundary and useEmporixErrorHandler"
```

---

## Task 8: SSR helpers, exports, verification, changeset

**Files:**
- Create: `packages/react/src/ssr.ts`, `packages/react/tests/ssr.test.ts`
- Modify: `packages/react/src/index.ts`
- Create: `.changeset/react-package.md`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { prefetchProduct } from "../src/ssr";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ssr", () => {
  it("prefetchProduct fills a QueryClient that dehydrates", async () => {
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();
    await prefetchProduct(qc, client, "p1", auth.anonymous());
    const state = dehydrate(qc);
    expect(JSON.stringify(state)).toContain("Widget");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/ssr.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `packages/react/src/ssr.ts`**

```ts
import type { QueryClient } from "@tanstack/react-query";
import { auth, type AuthContext, type EmporixClient } from "@viu/emporix-sdk";

/**
 * Server-side prefetch of a product into a {@link QueryClient}, using the same
 * query key shape as `useProduct` so client hydration is a cache hit.
 * Create the `EmporixClient` once per server, never per request.
 */
export async function prefetchProduct(
  qc: QueryClient,
  client: EmporixClient,
  productId: string,
  authCtx: AuthContext = auth.anonymous(),
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: [
      "emporix",
      "product",
      productId,
      { tenant: client.tenant, authKind: authCtx.kind },
    ],
    queryFn: () => client.products.get(productId, undefined, authCtx),
  });
}

/**
 * Server-side prefetch of a cart. Pass the customer/anonymous context resolved
 * from the request (e.g. a token read from an httpOnly cookie).
 */
export async function prefetchCart(
  qc: QueryClient,
  client: EmporixClient,
  cartId: string,
  authCtx: AuthContext,
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: ["emporix", "cart", cartId, { tenant: client.tenant, authKind: authCtx.kind }],
    queryFn: () => client.carts.get(cartId, authCtx),
  });
}
```

- [ ] **Step 4: Populate `packages/react/src/index.ts`**

```ts
export { EmporixProvider, useEmporix } from "./provider";
export type { EmporixProviderProps } from "./provider";
export type { TokenStorage } from "./storage/index";
export {
  createMemoryStorage, createLocalStorageStorage, createCookieStorage,
} from "./storage/index";
export {
  useCustomerSession,
  useProduct, useProducts, useProductsInfinite,
  useCategory, useCategories, useCategoryTree, useCart,
  useCartMutations,
} from "./hooks/index";
export type { CustomerSessionApi, CartMutationsApi } from "./hooks/index";
export { EmporixErrorBoundary, useEmporixErrorHandler } from "./errors";
export { prefetchProduct, prefetchCart } from "./ssr";
```

Then verify the actual tsup-emitted filenames and align `package.json`
`exports` (Task 1) to them: run `pnpm --filter @viu/emporix-sdk-react build`
and `ls packages/react/dist`. If hooks/storage emit as `hooks/index.js` rather
than `hooks.js`, update the `exports` map paths accordingly.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/ssr.test.ts`
Expected: PASS.

- [ ] **Step 6: Full verification (mirrors CI)**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS; react coverage ≥ 80% lines/branches (barrels excluded). If a
threshold fails, add focused hook tests (don't lower the threshold).

- [ ] **Step 7: Create `.changeset/react-package.md`**

```md
---
"@viu/emporix-sdk": patch
"@viu/emporix-sdk-react": minor
---

Add @viu/emporix-sdk-react: provider, pluggable token storage, customer
session, query hooks, cart mutations with optimistic updates, error helpers and
SSR prefetch helpers. Core: expose EmporixClient.tenant for query-key namespacing.
```

- [ ] **Step 8: Commit**

```bash
git add packages/react packages/sdk/src/client.ts .changeset/react-package.md
git commit -m "feat(react): add SSR helpers, public exports and changeset"
```

---

## Self-Review

**Spec coverage (§3.6, §12; milestones 10–14):**
- M10 scaffold: peer deps (`@viu/emporix-sdk` workspace, react-query v5, react 18||19), tsup multi-entry, vitest+jsdom, eslint react-hooks, subpath exports (Task 1, finalized Task 8 Step 4). ✓
- M11 provider + memory storage + `useEmporix` + `useCustomerSession`: Tasks 2, 4. Provider-missing throws (Task 2 test); login stores token + invalidates customer/cart queries; logout clears (Task 4 tests). ✓
- M12 query hooks product/category/cart (+products/infinite/categories/tree): Task 5; per-tenant + per-authKind query keys; `options.auth` override; customer-vs-anonymous default. ✓
- M13 `useCartMutations` optimistic + rollback: Task 6 (addItem cache patch + error rollback tested). ✓
- M14 localStorage + cookie adapters: Task 3 (custom key, SSR fallback+warn, cookie attrs). ✓
- Error handling (`EmporixErrorBoundary`, `useEmporixErrorHandler`) and SSR (`prefetchProduct`/`prefetchCart`, client-once-per-server documented): Tasks 7, 8. ✓
- Constraint "react package imports only the published interface": shipped code imports `@viu/emporix-sdk`; the src alias is test-only and called out in the header. ✓

**Placeholder scan:** No TBD/TODO. The tsup→exports filename reconciliation is an
explicit verification step (Task 8 Step 4), not a placeholder — emitted paths
are tool-determined and must be confirmed against `dist/`.

**Type consistency:** `TokenStorage` shape identical across all adapters and
provider. `useEmporix()` returns `{ client, storage }` everywhere consumed.
Query-key tuples consistent: `["emporix", <resource>, <id/params>, { tenant,
authKind }]` across queries.ts, use-cart-mutations.ts, ssr.ts. `EmporixClient`
gains `readonly tenant` (Task 2) and is consumed as such in queries/ssr/session.
SDK types (`Product/Category/Cart/CartAddress/Page/AuthContext/auth/EmporixError
/EmporixAuthError/Customer`) imported from the package, matching Plan 2 exports.

**Deviation note (carried):** Plan 4 must re-add the Changesets
`ignore: ["@viu/emporix-examples-*"]` glob once example packages exist.
