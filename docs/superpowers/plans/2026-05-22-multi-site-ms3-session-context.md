# Multi-Site MS-3 — Session-Context Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `setSite()` **persist server-side** by PATCHing the session-context, and expose `isSwitching` / `switchError` on `useSiteContext()` for UI feedback. Adds a `client.sessionContext` service binding `GET /session-context/{tenant}/me/context` and `PATCH /session-context/{tenant}/me/context`.

**Architecture:** Mirrors the existing service pattern (SiteService from MS-1). The PATCH endpoint requires optimistic-locking via `metadata.version`, so the SDK does an opportunistic GET first to fetch the current version, then PATCHes. The session-context **does not exist** server-side until the user creates a cart — the SDK treats GET-404 as "no session yet, skip the PATCH". Local state still flips instantly so the UI feels responsive; PATCH failures are surfaced via `switchError` but do not roll back the optimistic state.

**Tech Stack:** TypeScript, native `fetch`, TanStack React Query v5, Vitest + MSW.

**Context for the engineer:**
- Spec: `docs/superpowers/specs/2026-05-21-multi-site-foundation-design.md` — read MS-3 section first.
- Branch: `feat/multi-site-ms3-session-context` (already created off `main` at `c1ecea6`).
- MS-1 + MS-2 shipped. `client.sites`, `useSites()`, `useDefaultSite()`, `<EmporixProvider initialSiteCode>`, `useSiteContext()`, `EmporixStorage.{get,set}SiteCode`, and cache-key migration are live.
- Server fact: the session-context resource is only created when the user creates a cart (GET returns 404 before that). The SDK's `setSite()` must NOT throw when this happens — it should still update local state.
- PATCH body shape: `{ siteCode?, currency?, targetLocation?, language?, context?, metadata: { version } }`. `metadata` is required. The SDK assembles this from a `SessionContextPatch` input + a fetched version.
- Auth: both endpoints use the customer-or-anonymous token from `Authorization`. Use `useReadAuth()` defaults.
- 204 No Content on success — `request<T>` typically expects JSON; check how other services handle 204 (e.g. customer logout). The `HttpClient` likely returns `undefined` for 204; if not, set the generic to `void`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sdk/src/services/session-context.ts` | SessionContextService + types | **CREATE** |
| `packages/sdk/src/index.ts` | Public re-exports | Modify (add `SessionContextService`, `SessionContext`, `SessionContextPatch`) |
| `packages/sdk/src/client.ts` | EmporixClient wiring | Modify (new `sessionContext` field) |
| `packages/sdk/src/core/logger.ts` | ServiceName union | Modify (add `"session-context"`) |
| `packages/sdk/tests/services/session-context.test.ts` | SDK unit tests | **CREATE** |
| `packages/react/src/provider.tsx` | EmporixProvider + SiteContextValue | Modify (async setSite, isSwitching, switchError) |
| `packages/react/tests/use-site-context.test.tsx` | site-context tests | Modify (add 6 MS-3 cases) |
| `docs/react.md` | Public docs | Modify (update Sites section for async setSite) |
| `.changeset/multi-site-ms3.md` | Release notes | **CREATE** |

---

## Task 1: SDK `SessionContextService`

**Files:**
- Create: `packages/sdk/src/services/session-context.ts`
- Create: `packages/sdk/tests/services/session-context.test.ts`
- Modify: `packages/sdk/src/core/logger.ts`

- [ ] **Step 1: Add `"session-context"` to `ServiceName`**

In `packages/sdk/src/core/logger.ts`, append `"session-context"` to the `ServiceName` union:

```ts
export type ServiceName =
  | "customer"
  | "product"
  // … existing entries …
  | "site"
  | "session-context"     // ← new
  | "http"
  | "auth";
```

- [ ] **Step 2: Write the failing tests**

Create `packages/sdk/tests/services/session-context.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { SessionContextService } from "../../src/services/session-context";
import { auth } from "../../src/core/auth";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SessionContextService>[0] {
  return {
    tenant: "viu",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: {
      trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("SessionContextService.get", () => {
  it("GETs /session-context/{tenant}/me/context", async () => {
    const request = vi.fn().mockResolvedValue({
      sessionId: "s1",
      siteCode: "main",
      currency: "CHF",
      targetLocation: "CH",
      metadata: { version: 3 },
    });
    const svc = new SessionContextService(ctxWith(request));
    const sc = await svc.get();
    expect(sc.siteCode).toBe("main");
    expect(sc.metadata?.version).toBe(3);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/session-context/viu/me/context",
      }),
    );
  });

  it("returns null on 404 (no session context yet — happens before first cart)", async () => {
    const e: { status?: number } = Object.assign(new Error("not found"), { status: 404 });
    const request = vi.fn().mockRejectedValue(e);
    const svc = new SessionContextService(ctxWith(request));
    const sc = await svc.get();
    expect(sc).toBeNull();
  });

  it("propagates non-404 errors", async () => {
    const e: { status?: number } = Object.assign(new Error("boom"), { status: 500 });
    const request = vi.fn().mockRejectedValue(e);
    const svc = new SessionContextService(ctxWith(request));
    await expect(svc.get()).rejects.toThrow(/boom/);
  });
});

describe("SessionContextService.patch", () => {
  it("PATCHes with siteCode + metadata.version (lazy GET to fetch version)", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ sessionId: "s1", siteCode: "old", metadata: { version: 7 } })
      .mockResolvedValueOnce(undefined); // 204 No Content
    const svc = new SessionContextService(ctxWith(request));
    await svc.patch({ siteCode: "new" });

    // 1) GET fetches current version.
    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/session-context/viu/me/context",
      }),
    );
    // 2) PATCH includes the fetched version under metadata.
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "PATCH",
        path: "/session-context/viu/me/context",
        body: expect.objectContaining({
          siteCode: "new",
          metadata: { version: 7 },
        }),
      }),
    );
  });

  it("skips PATCH gracefully when GET returns 404 (no session yet)", async () => {
    const e: { status?: number } = Object.assign(new Error("not found"), { status: 404 });
    const request = vi.fn().mockRejectedValueOnce(e);
    const svc = new SessionContextService(ctxWith(request));
    // Should resolve to false (skipped), not throw.
    const applied = await svc.patch({ siteCode: "new" });
    expect(applied).toBe(false);
    expect(request).toHaveBeenCalledTimes(1); // only the GET
  });

  it("returns true when PATCH applies successfully", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ metadata: { version: 1 } })
      .mockResolvedValueOnce(undefined);
    const svc = new SessionContextService(ctxWith(request));
    const applied = await svc.patch({ siteCode: "X" });
    expect(applied).toBe(true);
  });

  it("honours an explicit version (skips the GET)", async () => {
    const request = vi.fn().mockResolvedValueOnce(undefined);
    const svc = new SessionContextService(ctxWith(request));
    const applied = await svc.patch({ siteCode: "Y", version: 42 });
    expect(applied).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          siteCode: "Y",
          metadata: { version: 42 },
        }),
      }),
    );
  });

  it("passes the explicit AuthContext through", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ metadata: { version: 1 } })
      .mockResolvedValueOnce(undefined);
    const svc = new SessionContextService(ctxWith(request));
    await svc.patch({ siteCode: "X" }, auth.customer("tok"));
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      auth: expect.objectContaining({ kind: "customer" }),
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      auth: expect.objectContaining({ kind: "customer" }),
    }));
  });
});
```

- [ ] **Step 3: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk test -- session-context.test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Create `packages/sdk/src/services/session-context.ts`**

```typescript
import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";

const ANON: AuthContext = auth.anonymous();

/**
 * One session context as returned by `GET /session-context/{tenant}/me/context`.
 * Created server-side when the user creates a cart. Until then, the server
 * returns 404 and {@link SessionContextService.get} resolves to `null`.
 */
export interface SessionContext {
  sessionId: string;
  customerId?: string;
  siteCode?: string;
  currency?: string;
  cartId?: string;
  targetLocation?: string;
  language?: string;
  context?: Record<string, unknown>;
  metadata?: {
    version?: number;
    createdAt?: string;
    modifiedAt?: string;
  };
}

/**
 * Input for {@link SessionContextService.patch}. Only the listed fields are
 * accepted by the server; everything else is ignored.
 *
 * If `version` is omitted, the service fetches the current version via GET
 * before PATCHing (one extra round-trip). Pass it explicitly when you already
 * know it (e.g. after a `get()` call earlier in the same flow).
 */
export interface SessionContextPatch {
  siteCode?: string;
  currency?: string;
  targetLocation?: string;
  language?: string;
  context?: Record<string, unknown>;
  /** Override for optimistic-locking version. If omitted, GET resolves it. */
  version?: number;
}

/**
 * Session-context binding for the current storefront session. Both endpoints
 * resolve the session-id from the `Authorization` token — no path/query
 * parameter required.
 */
export class SessionContextService {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Retrieves the current session context, or `null` when the server returns
   * 404 (no session exists yet — the session-context is created server-side
   * only after the user creates a cart).
   */
  async get(authCtx: AuthContext = ANON): Promise<SessionContext | null> {
    try {
      return await this.ctx.http.request<SessionContext>({
        method: "GET",
        path: `/session-context/${this.ctx.tenant}/me/context`,
        auth: authCtx,
      });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Partially updates the current session context. Returns `true` when the
   * PATCH was applied, `false` when there is no session context yet (the
   * server returned 404 on the version-lookup GET, so there is nothing to
   * update). Non-404 errors propagate.
   */
  async patch(input: SessionContextPatch, authCtx: AuthContext = ANON): Promise<boolean> {
    let version = input.version;
    if (version === undefined) {
      const current = await this.get(authCtx);
      if (current === null) return false; // No session yet — nothing to patch.
      version = current.metadata?.version;
      if (version === undefined) {
        throw new Error(
          "SessionContextService.patch: no metadata.version in server response",
        );
      }
    }
    const { version: _v, ...fields } = input;
    void _v;
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `/session-context/${this.ctx.tenant}/me/context`,
      body: {
        ...fields,
        metadata: { version },
      },
      auth: authCtx,
    });
    return true;
  }
}

function isNotFound(err: unknown): boolean {
  if (err && typeof err === "object") {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status === 404) return true;
  }
  return false;
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk test -- session-context.test`
Expected: PASS for all 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/session-context.ts \
        packages/sdk/tests/services/session-context.test.ts \
        packages/sdk/src/core/logger.ts
git commit -m "feat(sdk): add SessionContextService.get/patch"
```

---

## Task 2: Wire `client.sessionContext` + public exports

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Wire into `EmporixClient`**

In `packages/sdk/src/client.ts`:

1. Add import:
   ```ts
   import { SessionContextService } from "./services/session-context";
   ```
2. Add the field next to other service fields:
   ```ts
   readonly sessionContext: SessionContextService;
   ```
3. Add the instantiation alongside other services in the constructor:
   ```ts
   this.sessionContext = new SessionContextService(mk("session-context"));
   ```

- [ ] **Step 2: Re-export from the SDK index**

In `packages/sdk/src/index.ts`, append:

```ts
export { SessionContextService } from "./services/session-context";
export type { SessionContext, SessionContextPatch } from "./services/session-context";
```

- [ ] **Step 3: Build + typecheck + test**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk test
```
Expected: all green. SDK test count grows by 7 (e.g. 148 → 155).

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): wire SessionContextService into EmporixClient"
```

---

## Task 3: Async `setSite` + `isSwitching` + `switchError`

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Modify: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/use-site-context.test.tsx`:

```tsx
describe("useSiteContext — async setSite (MS-3)", () => {
  it("setSite returns a Promise and calls sessionContext.patch", async () => {
    let patchCall: { siteCode?: string; metadata?: { version?: number } } | undefined;
    server.use(
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({
          sessionId: "sess1",
          siteCode: "old",
          metadata: { version: 5 },
        }),
      ),
      http.patch("https://api.emporix.io/session-context/acme/me/context", async ({ request }) => {
        patchCall = (await request.json()) as typeof patchCall;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap({ storage }) });
    await act(async () => {
      await result.current.setSite("new-site");
    });
    expect(result.current.siteCode).toBe("new-site");
    expect(storage.getSiteCode()).toBe("new-site");
    expect(patchCall?.siteCode).toBe("new-site");
    expect(patchCall?.metadata?.version).toBe(5);
  });

  it("setSite resolves OK when server has no session context yet (404 on GET → skip PATCH)", async () => {
    server.use(
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        new HttpResponse(null, { status: 404 }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap({ storage }) });
    await act(async () => {
      await result.current.setSite("X");
    });
    expect(result.current.siteCode).toBe("X");
    expect(result.current.switchError).toBeNull();
  });

  it("isSwitching toggles around the async PATCH", async () => {
    let resolveServer: (() => void) | undefined;
    const serverDelay = new Promise<void>((r) => {
      resolveServer = r;
    });
    server.use(
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ sessionId: "s", metadata: { version: 1 } }),
      ),
      http.patch("https://api.emporix.io/session-context/acme/me/context", async () => {
        await serverDelay;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap() });
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.setSite("X");
    });
    // Optimistic state flip happens synchronously inside setSite call.
    expect(result.current.siteCode).toBe("X");
    // isSwitching becomes true on next render after the await begins.
    await waitForNextRender();
    expect(result.current.isSwitching).toBe(true);
    resolveServer!();
    await act(async () => {
      await pending;
    });
    expect(result.current.isSwitching).toBe(false);
  });

  it("switchError is populated when PATCH fails (state stays optimistic)", async () => {
    server.use(
      http.get("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ sessionId: "s", metadata: { version: 1 } }),
      ),
      http.patch("https://api.emporix.io/session-context/acme/me/context", () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap() });
    await act(async () => {
      await result.current.setSite("X");
    });
    // Optimistic state stays — user's UI already moved on.
    expect(result.current.siteCode).toBe("X");
    expect(result.current.switchError).not.toBeNull();
  });

  it("setSite(null) does not call PATCH (no session context to clear)", async () => {
    let called = 0;
    server.use(
      http.get("https://api.emporix.io/session-context/acme/me/context", () => {
        called += 1;
        return new HttpResponse(null, { status: 404 });
      }),
      http.patch("https://api.emporix.io/session-context/acme/me/context", () => {
        called += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap() });
    await act(async () => {
      await result.current.setSite(null);
    });
    expect(called).toBe(0); // No PATCH because there's no siteCode to send.
  });
});

// Helper: yields back to React so a state update made just before this call
// has time to schedule + commit. Used to assert intermediate state
// (`isSwitching === true`) during an in-flight async setSite.
async function waitForNextRender(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}
```

Add `useSiteContext`-test setup that already wires `EmporixClient` to MSW — the existing `wrap()` helper handles auth. No further infrastructure changes.

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: FAIL — `setSite` is sync void, returning the call wrapped in `await` resolves to `undefined` but `isSwitching`/`switchError` don't exist.

- [ ] **Step 3: Update `SiteContextValue` + `SiteContextProvider` for async `setSite`**

In `packages/react/src/provider.tsx`, replace the `SiteContextValue` interface and the `SiteContextProvider` component:

```tsx
export interface SiteContextValue {
  siteCode: string | null;
  /** MS-4 populates this from the active site's DTO. */
  currency: string | null;
  /** MS-4 populates this from the active site's DTO. */
  targetLocation: string | null;
  /**
   * Asynchronous site switch. Updates local state + storage immediately
   * (optimistic), then PATCHes `/session-context/{tenant}/me/context` so the
   * server sees the same site on the next request. When no session context
   * exists yet (first visit, before any cart), the PATCH is skipped — local
   * state still flips.
   *
   * `isSwitching` is `true` while the PATCH is in flight. `switchError`
   * surfaces a PATCH failure; the optimistic state is NOT rolled back
   * (the cache was already invalidated, the UI already moved on).
   */
  setSite: (code: string | null) => Promise<void>;
  isSwitching: boolean;
  switchError: Error | null;
}
```

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
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<Error | null>(null);

  const setSite = useCallback(
    async (code: string | null) => {
      // 1) Optimistic local flip — UI moves immediately.
      storage.setSiteCode(code);
      storage.setCartId(null); // Carts are site-aware.
      setSiteCodeState(code);
      setSwitchError(null);
      void qc.invalidateQueries({ queryKey: ["emporix"] });

      // 2) Server-side sync. Skip when clearing (no PATCH target).
      if (code === null) return;
      setIsSwitching(true);
      try {
        const token = storage.getCustomerToken();
        const authCtx = token
          ? (await import("@viu/emporix-sdk")).auth.customer(token)
          : (await import("@viu/emporix-sdk")).auth.anonymous();
        await client.sessionContext.patch({ siteCode: code }, authCtx);
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
      currency: null,
      targetLocation: null,
      setSite,
      isSwitching,
      switchError,
    }),
    [siteCode, setSite, isSwitching, switchError],
  );

  return <EmporixSiteContext.Provider value={value}>{children}</EmporixSiteContext.Provider>;
}
```

**Note on the dynamic `import("@viu/emporix-sdk")`:** that's an ugly workaround if a top-level `import { auth } from "@viu/emporix-sdk"` isn't already in `provider.tsx`. Prefer the static import — add to the imports block at the top of the file:

```ts
import { auth } from "@viu/emporix-sdk";
```

Then `setSite` simplifies to:

```ts
const token = storage.getCustomerToken();
const authCtx = token ? auth.customer(token) : auth.anonymous();
await client.sessionContext.patch({ siteCode: code }, authCtx);
```

Use this static-import variant for the implementation.

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: PASS for all 8 MS-2 tests + 5 new MS-3 tests = 13 total.

- [ ] **Step 5: Run full suite for sanity**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: 122 + 5 = 127 React tests passing. Existing call sites of `setSite` (in MS-2 tests) used `act(() => result.current.setSite("X"))` — that still works because awaiting a Promise inside `act` is fine; sync usage `act(() => setSite("X"))` also works (the call returns a Promise, the act block doesn't await it; React still flushes synchronous state updates).

If MS-2 tests fail because they relied on synchronous completion, wrap the affected calls in `await act(async () => { await result.current.setSite("X"); })`.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): async setSite + isSwitching + switchError"
```

---

## Task 4: Docs + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/multi-site-ms3.md`

- [ ] **Step 1: Update `docs/react.md`**

In the existing "Sites" section, replace the closing paragraph (the one mentioning "Server-side session-context sync arrives in MS-3 …") with:

```markdown
`setSite(code)` writes `storage.setSiteCode(code)`, clears `storage.cartId`
(carts are site-aware), and invalidates `["emporix"]` queries — all
site-aware caches refetch on the new site. Then it PATCHes
`/session-context/{tenant}/me/context` so the server sees the new site on
the next request. The UI flips immediately (optimistic); `isSwitching`
exposes the in-flight PATCH so a switcher button can show a spinner, and
`switchError` carries any PATCH failure (rare — the optimistic state is
NOT rolled back, since the caches already invalidated).

When no cart has been created yet, the server has no session-context for
the user — the SDK skips the PATCH in that case (GET returns 404) and
local state still flips.

In MS-4 `currency` and `targetLocation` auto-derive from the active site's
DTO; today they stay `null`.
```

- [ ] **Step 2: Create changeset**

Create `.changeset/multi-site-ms3.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Multi-site MS-3: server-side session-context sync.

**SDK**
- `client.sessionContext.get()` — `GET /session-context/{tenant}/me/context`.
  Returns `null` (not throws) when the server returns 404 — i.e. when the
  user has not created a cart yet and no session-context exists.
- `client.sessionContext.patch(input)` — `PATCH /session-context/{tenant}/me/context`
  with optimistic-locking. Looks up `metadata.version` via GET first
  unless caller provides one. Returns `true` when applied, `false` when
  there is no session context yet (404 on the GET → patch skipped).
- New `SessionContext` and `SessionContextPatch` types.

**React**
- `setSite()` is now async. It flips local state + storage + cart-id
  + cache-invalidation synchronously (optimistic UI), then PATCHes the
  server. Skips the PATCH when no session exists yet (404 on GET).
- `useSiteContext()` gains `isSwitching: boolean` and
  `switchError: Error | null`. The optimistic state is NOT rolled back
  on PATCH failure — surface the error in UI; the next user interaction
  retries.

No breaking changes. Existing call sites continue to work — `setSite("X")`
without `await` still flips the UI; awaiting it blocks until the
server-side sync completes.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/multi-site-ms3.md
git commit -m "docs(repo): document async setSite + session-context; MS-3 changeset"
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
- `@viu/emporix-sdk`: was 148 → **155** (+7 session-context tests).
- `@viu/emporix-sdk-react`: was 122 → **127** (+5 MS-3 tests).
- All builds + typecheck green.

- [ ] **Step 2: E2E sanity**

```bash
set -a; source e2e/.env.local 2>/dev/null; set +a
pnpm e2e
```
Expected: 6/6 still passing. MS-3 is additive — `setSite` is not called in the existing e2e flows.

- [ ] **Step 3: Sanity grep**

```bash
git grep -n "SessionContextService\|sessionContext\.patch\|sessionContext\.get" \
  packages/sdk/src packages/react/src 2>/dev/null
```
Expected: each symbol appears in the right files (service definition, client wiring, provider).

- [ ] **Step 4: Branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 5 commits, in order:
1. MS-3 plan (this file)
2. SDK SessionContextService + tests
3. EmporixClient wiring
4. async setSite + isSwitching + switchError
5. Docs + changeset

---

## Follow-ups (out of scope, ship as MS-4)

- Currency + targetLocation auto-derivation from the active site's DTO.
- `customerprefferedSite` honour at login.

## Out of scope (deferred to a later follow-up)

- Site-switcher UI in `examples/vite-spa` + `examples/next-app-router`.
- Session-context attribute add/delete endpoints (POST `/me/context/attributes`, DELETE `/me/context/attributes/{name}`). No concrete consumer needs them yet.
- `prefetchSessionContext` for SSR.
