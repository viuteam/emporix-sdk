# Host-Owned Customer Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `EmporixProvider` run on a customer token owned by a host application — the
Emporix Managed Dashboard handing a federated module its `appState.token` — without
bootstrapping a B2B company context, without ever attempting a refresh, and picking up a
rotated token.

**Architecture:** One new provider prop, `customerSession?: "owned" | "external"`, gates
three behaviours that always travel together. Token seeding and rotation move into the
existing `useProviderWiring` hook, which already runs during render precisely so it precedes
the children's first fetch. The company bootstrap and the refresher each learn the mode and
opt out.

**Tech Stack:** React 18/19, `@tanstack/react-query` v5, Vitest + MSW +
`@testing-library/react`, `@originjs/vite-plugin-federation` (for the example).

**Spec:** [`../specs/2026-08-10-external-customer-session-design.md`](../specs/2026-08-10-external-customer-session-design.md)

## Global Constraints

- **Everything written into the repo is English** — comments, JSDoc, changesets, commit
  messages, PR bodies, README prose, test names (`CLAUDE.md`).
- **Commitlint:** scope from `repo, release, sdk, react, core, customer, product, category,
  cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps,
  docs, examples`. First word after the scope must be a **lowercase verb**.
- **`exactOptionalPropertyTypes: true`** repo-wide (`tsconfig.base.json:9`) — `{ x: undefined }`
  is not assignable to `{ x?: T }`; spread optional fields conditionally.
- **Changeset required** for any PR touching `packages/*/src/**`.
- **`@viu/emporix-examples-*` are under `ignore`** in `.changeset/config.json` — never
  versioned, never published.
- **Verification before any completion claim:** run `pnpm -r test` and `pnpm typecheck`, and
  report the actual output.
- **Never merge a PR.** Open it and hand it over.
- **Branch:** `feat/external-customer-session` (already created; holds the spec commit).

## Reference: what the three gaps are

Every task below closes one. Named here so a task's implementer knows why.

1. `useCompanyBootstrap` calls `client.companies.listMine()` in a mount effect whenever a
   customer token is present (`use-company-bootstrap.ts:110`). For a dashboard operator that
   is a request for a shop customer's legal entities — unwanted, likely 403.
2. `useCustomerTokenRefresher` opens with `if (!enabled) return`, so
   `onCustomerSessionExpired` only fires when `autoRefreshCustomerToken` is true — which is
   wrong for a token with no refresh token.
3. Rotation: `provider.tsx:32-39` puts `initialCustomerToken` in the storage `useMemo` deps,
   so a new token rebuilds storage and discards `cartId` / `siteCode` / `language` /
   `activeLegalEntityId`. With a caller-supplied `storage` it does not rotate at all — the
   seed is guarded by `getCustomerToken() === null`.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `packages/react/src/provider.types.ts` | declares `customerSession` on `EmporixProviderProps` |
| `packages/react/src/provider.tsx` | stable storage identity; threads the mode to the three consumers |
| `packages/react/src/hooks/internal/use-provider-wiring.ts` | owns anon-store attach **plus** token seed and rotation |
| `packages/react/src/company-context.types.ts` | adds `EXTERNAL_CTX` beside `NULL_CTX` |
| `packages/react/src/hooks/internal/use-company-bootstrap.ts` | skips its two effects and returns `EXTERNAL_CTX` in external mode |
| `packages/react/src/company-context.tsx` | passes the mode through |
| `packages/react/src/hooks/internal/use-customer-token-refresher.ts` | registers a report-only refresher in external mode |
| `packages/react/README.md` | a Managed Dashboard section — the integration recipe |
| `docs/react.md` | provider-prop reference + the pitfall entry |
| `examples/md-module/` | new: a federation remote wired exactly as the README says |
| `examples/README.md` | one row for the new example, plus its run command |

---

## Task 1: the prop, stable storage, and rotation

**Files:**
- Modify: `packages/react/src/provider.types.ts:51-94` (`EmporixProviderProps`)
- Modify: `packages/react/src/provider.tsx:19-55`
- Modify: `packages/react/src/hooks/internal/use-provider-wiring.ts` (whole file)
- Test: `packages/react/tests/provider-external-session.test.tsx` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `EmporixProviderProps.customerSession?: "owned" | "external"`;
  `useProviderWiring({ client, storage, initialCustomerToken?, customerSession })` where
  `customerSession: "owned" | "external"` is **required** (the provider always passes a
  resolved value). The `externalStorage` argument is **removed**.

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/provider-external-session.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useEmporix } from "../src/provider";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client(): EmporixClient {
  // No credentials at all: a host-owned token needs none. validateConfig only
  // requires the object to exist, and DefaultTokenProvider checks lazily.
  return new EmporixClient({ tenant: "acme", credentials: {}, logger: false });
}

function wrap(opts: { token?: string; storage?: EmporixStorage }) {
  const c = client();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={c}
      queryClient={qc}
      customerSession="external"
      {...(opts.storage ? { storage: opts.storage } : {})}
      {...(opts.token !== undefined ? { initialCustomerToken: opts.token } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("EmporixProvider customerSession='external'", () => {
  it("seeds the host token into the memory fallback before children render", () => {
    const { result } = renderHook(() => useEmporix(), { wrapper: wrap({ token: "host-1" }) });
    expect(result.current.storage.getCustomerToken()).toBe("host-1");
  });

  it("a rotated token reaches storage without discarding the rest of it", async () => {
    const storage = createMemoryStorage();
    storage.setCartId("cart-9");
    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender, result } = renderHook(() => useEmporix(), {
      wrapper: ({ children, token }: { children: ReactNode; token: string }) => (
        <EmporixProvider
          client={c}
          queryClient={qc}
          storage={storage}
          customerSession="external"
          initialCustomerToken={token}
        >
          {children}
        </EmporixProvider>
      ),
      initialProps: { token: "host-1" },
    });

    expect(result.current.storage.getCustomerToken()).toBe("host-1");
    rerender({ token: "host-2" });
    await waitFor(() => expect(storage.getCustomerToken()).toBe("host-2"));
    // The whole point: rotation must not be implemented by rebuilding storage.
    expect(storage.getCartId()).toBe("cart-9");
  });

  it("the rotated token is what the next request sends", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return HttpResponse.json({ id: "p1" });
      }),
    );
    const storage = createMemoryStorage({ initial: "host-2" });
    const c = client();
    await c.products.get("p1", undefined, { kind: "customer", token: storage.getCustomerToken()! });
    expect(seen).toEqual(["Bearer host-2"]);
  });
});

describe("EmporixProvider customerSession='owned' (default)", () => {
  it("does not clobber a live session token with a stale initial one", () => {
    const storage = createMemoryStorage({ initial: "live" });
    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useEmporix(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <EmporixProvider
          client={c}
          queryClient={qc}
          storage={storage}
          initialCustomerToken="stale-ssr"
        >
          {children}
        </EmporixProvider>
      ),
    });
    expect(result.current.storage.getCustomerToken()).toBe("live");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F @viu/emporix-sdk-react test -- tests/provider-external-session.test.tsx
```

Expected: FAIL — TypeScript rejects the `customerSession` prop (it does not exist yet), and
the rotation case fails on `getCartId()` because storage is rebuilt.

- [ ] **Step 3: Declare the prop**

In `packages/react/src/provider.types.ts`, inside `EmporixProviderProps`, immediately after
`initialCustomerToken?: string;`:

```ts
  /**
   * Who owns the customer token.
   *
   * `"owned"` (default) — the storefront model: the token came from a login this
   * provider performed or restored, may be refreshed, and belongs to a shop
   * customer who may have legal entities.
   *
   * `"external"` — the token was handed in by a host application (an Emporix
   * Managed Dashboard module, an embedded admin UI). The SDK never refreshes it,
   * never bootstraps a company context from it, and treats a changed
   * `initialCustomerToken` as authoritative. `autoRefreshCustomerToken` is
   * ignored; `onCustomerSessionExpired` still fires on a 401.
   */
  customerSession?: "owned" | "external";
```

- [ ] **Step 4: Make storage identity stable and thread the mode**

In `packages/react/src/provider.tsx`, add `customerSession` to the destructured props (after
`initialCustomerToken`), then replace the storage `useMemo` (lines 32–39):

```ts
  const session = customerSession ?? "owned";

  // Fallback storage held in state, not useMemo, and NOT keyed on the token:
  // recreating storage to deliver a new token silently discards cartId,
  // siteCode, language and activeLegalEntityId. Seeding and rotation are
  // useProviderWiring's job. Same reasoning as `fallbackQc` below.
  const [fallbackStorage] = useState(() => createMemoryStorage());
  const value = useMemo<EmporixContextValue>(
    () => ({ client, storage: storage ?? fallbackStorage }),
    [client, storage, fallbackStorage],
  );
```

Then replace the `useProviderWiring` call (lines 49–54) with:

```ts
  useProviderWiring({
    client,
    storage: value.storage,
    customerSession: session,
    ...(initialCustomerToken !== undefined ? { initialCustomerToken } : {}),
  });
```

- [ ] **Step 5: Move seeding and rotation into the wiring hook**

Replace `packages/react/src/hooks/internal/use-provider-wiring.ts` entirely:

```ts
import { useRef } from "react";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../../storage/index";

interface ProviderWiringArgs {
  client: EmporixClient;
  /** Resolved storage (the `storage` prop or the provider's memory fallback). */
  storage: EmporixStorage;
  initialCustomerToken?: string;
  /** See `EmporixProviderProps.customerSession`. Always resolved by the provider. */
  customerSession: "owned" | "external";
}

/**
 * Idempotent wiring that must precede the children's first fetch effects:
 * (1) attach the storage-backed anonymous-session adapter to the SDK token
 * provider, (2) seed — and in external mode re-seed — the customer token.
 *
 * Done during render with ref guards, not in an effect. A `useState` lazy
 * initializer runs once per component INSTANCE and silently skips re-wiring on
 * prop swaps; a `useEffect` runs AFTER the children fetch. The storage write is
 * therefore a render-phase side effect, deliberately: it must be visible to the
 * children on their first render, and it is idempotent.
 */
export function useProviderWiring({
  client,
  storage,
  initialCustomerToken,
  customerSession,
}: ProviderWiringArgs): void {
  const wiredRef = useRef<{ client: EmporixClient; storage: EmporixStorage } | null>(null);
  if (wiredRef.current?.client !== client || wiredRef.current?.storage !== storage) {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => storage.getAnonymousSession(),
      write: (s) => storage.setAnonymousSession(s),
    });
    wiredRef.current = { client, storage };
  }

  const seededRef = useRef<{ storage: EmporixStorage; token: string } | null>(null);
  if (
    initialCustomerToken !== undefined &&
    (seededRef.current?.storage !== storage || seededRef.current?.token !== initialCustomerToken)
  ) {
    const stored = storage.getCustomerToken();
    // "owned": seed only into an empty slot — a live session must never be
    // clobbered by a stale SSR-provided token.
    // "external": the host owns the token, so a changed prop wins.
    const shouldWrite =
      customerSession === "external" ? stored !== initialCustomerToken : stored === null;
    if (shouldWrite) storage.setCustomerToken(initialCustomerToken);
    seededRef.current = { storage, token: initialCustomerToken };
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk-react test
pnpm typecheck
```

Expected: PASS. Run the **whole** React suite, not just the new file — `provider.test.tsx`,
`provider-b2b.test.tsx` and `auto-refresh-customer.test.tsx` all exercise the storage seed
path this step rewrote.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/provider.types.ts packages/react/src/provider.tsx \
  packages/react/src/hooks/internal/use-provider-wiring.ts \
  packages/react/tests/provider-external-session.test.tsx
git commit -m "feat(react): accept a host-owned customer token

customerSession='external' declares that the token was handed in by a host
application and that the SDK must not manage it. This step covers seeding and
rotation: a changed initialCustomerToken is now authoritative in external mode
and writes into the existing storage.

Storage identity stops depending on the token. It rebuilt storage to deliver a
new one, which silently discarded cartId, siteCode, language and
activeLegalEntityId — a latent bug in owned mode too."
```

---

## Task 2: no company bootstrap in external mode

**Files:**
- Modify: `packages/react/src/company-context.types.ts:29-39` (add `EXTERNAL_CTX` after `NULL_CTX`)
- Modify: `packages/react/src/hooks/internal/use-company-bootstrap.ts:8-13`, `:137-143`, `:149-157`, `:179-196`
- Modify: `packages/react/src/company-context.tsx:17-36`
- Modify: `packages/react/src/provider.tsx` (pass `customerSession` to `CompanyContextProvider`)
- Test: `packages/react/tests/provider-external-session.test.tsx`

**Interfaces:**
- Consumes: `EmporixProviderProps.customerSession` from Task 1.
- Produces: `EXTERNAL_CTX: CompanyContextValue` exported from `company-context.types.ts`;
  `CompanyContextProviderProps.customerSession: "owned" | "external"` (required);
  `useCompanyBootstrap` args gain `customerSession: "owned" | "external"` (required).

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/provider-external-session.test.tsx`, inside the
`customerSession='external'` describe:

```tsx
  it("makes no legal-entities request on mount even with a token present", async () => {
    // onUnhandledRequest: "error" in this file's server means an unexpected
    // legal-entities call fails the test by itself. The assertion below is the
    // readable statement of the same thing.
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => {
        calls += 1;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useActiveCompany(), {
      wrapper: wrap({ token: "host-1" }),
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(calls).toBe(0);
    expect(result.current.mode).toBe("b2c");
    expect(result.current.myCompanies).toEqual([]);
  });

  it("setActiveCompany rejects with the external-mode reason, not 'provider not mounted'", async () => {
    const { result } = renderHook(() => useActiveCompany(), {
      wrapper: wrap({ token: "host-1" }),
    });
    await expect(result.current.setActiveCompany("le-1")).rejects.toThrow(/customerSession/);
    await expect(result.current.setActiveCompany("le-1")).rejects.not.toThrow(/not mounted/);
  });
```

Add `useActiveCompany` to the file's imports:

```tsx
import { useActiveCompany } from "../src/company-context";
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm -F @viu/emporix-sdk-react test -- tests/provider-external-session.test.tsx
```

Expected: FAIL — `calls` is `1`, and `setActiveCompany` throws
`"CompanyContextProvider not mounted"`, which matches `/not mounted/`.

- [ ] **Step 3: Add the external context value**

In `packages/react/src/company-context.types.ts`, after the `NULL_CTX` declaration:

```ts
/**
 * Context value for `customerSession="external"`.
 *
 * Distinct from {@link NULL_CTX} on purpose: that value's error says the
 * provider is not mounted, which would be false here — it is mounted, it simply
 * has no company to switch between. A misleading error costs more than this
 * second constant.
 */
export const EXTERNAL_CTX: CompanyContextValue = {
  activeCompany: null,
  myCompanies: [],
  mode: "b2c",
  status: "idle",
  error: null,
  setActiveCompany: async () => {
    throw new Error(
      'setActiveCompany is unavailable: customerSession is "external", so no company ' +
        "context is bootstrapped. Call client.companies.listMine() directly if you need one.",
    );
  },
  refetchMyCompanies: async () => {},
};
```

- [ ] **Step 4: Gate the bootstrap**

In `packages/react/src/hooks/internal/use-company-bootstrap.ts`:

Add to the args interface (after `initialActiveLegalEntityId`):

```ts
  /** `"external"` skips the listMine bootstrap entirely — see EXTERNAL_CTX. */
  customerSession: "owned" | "external";
```

Add `customerSession` to the destructured parameters, and import `EXTERNAL_CTX`:

```ts
import { EXTERNAL_CTX, type CompanyContextValue, type CompanyMode } from "../../company-context.types";
```

Guard the mount effect (currently lines 137–143):

```ts
  useEffect(() => {
    if (customerSession === "external") return;
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load, customerSession]);
```

Guard the token-transition effect (currently lines 149–157):

```ts
  useEffect(() => {
    if (customerSession === "external") return;
    let prev = storage.getCustomerToken();
    return storage.subscribe?.((next) => {
      const becameAuth = !prev && next;
      const becameUnauth = prev && !next;
      prev = next;
      if (becameAuth || becameUnauth) void load();
    });
  }, [storage, load, customerSession]);
```

Change the tail so the memo still runs — hook order must not depend on the mode:

```ts
  const value = useMemo<CompanyContextValue>(() => {
    const mode: CompanyMode = activeCompany
      ? "b2b"
      : myCompanies.length > 1
        ? "unresolved"
        : "b2c";
    return {
      activeCompany,
      myCompanies,
      mode,
      status,
      error,
      setActiveCompany,
      refetchMyCompanies: load,
    };
  }, [activeCompany, myCompanies, status, error, setActiveCompany, load]);

  return customerSession === "external" ? EXTERNAL_CTX : value;
```

- [ ] **Step 5: Thread the mode through the provider**

In `packages/react/src/company-context.tsx`, add to `CompanyContextProviderProps`:

```ts
  customerSession: "owned" | "external";
```

destructure it, and pass it into `useCompanyBootstrap`:

```ts
  const value = useCompanyBootstrap({
    client,
    storage,
    emit,
    customerSession,
    ...(initialActiveLegalEntityId !== undefined ? { initialActiveLegalEntityId } : {}),
  });
```

In `packages/react/src/provider.tsx`, add `customerSession={session}` to the
`<CompanyContextProvider>` element.

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk-react test
pnpm typecheck
```

Expected: PASS, including `provider-b2b.test.tsx`, `use-active-company-bootstrap.test.tsx`,
`use-active-company-switch.test.tsx` and `telemetry-company-switched.test.tsx` unchanged —
they are the proof that `"owned"` behaviour is untouched.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/company-context.types.ts packages/react/src/company-context.tsx \
  packages/react/src/hooks/internal/use-company-bootstrap.ts packages/react/src/provider.tsx \
  packages/react/tests/provider-external-session.test.tsx
git commit -m "feat(react): skip the company bootstrap for an external session

With a customer token present the provider called companies.listMine() on
mount. For a Managed Dashboard operator that asks for the legal entities of a
shop customer who does not exist.

EXTERNAL_CTX rather than NULL_CTX: the latter's error says the provider is not
mounted, which would be false here."
```

---

## Task 3: report expiry without repairing it

**Files:**
- Modify: `packages/react/src/hooks/internal/use-customer-token-refresher.ts` (whole file)
- Modify: `packages/react/src/provider.tsx` (pass `customerSession` to the refresher hook)
- Test: `packages/react/tests/provider-external-session.test.tsx`

**Interfaces:**
- Consumes: `EmporixProviderProps.customerSession` from Task 1.
- Produces: `useCustomerTokenRefresher` args gain `customerSession: "owned" | "external"`
  (required). No public API change beyond the provider prop already added.

Background for the implementer: `client.setCustomerTokenRefresher(r)` sets
`CustomerRefreshRegistry.refresher`, and `registry.enabled` is `refresher !== null`
(`packages/sdk/src/core/auth.ts:155`). `HttpClient` consults it on a `customer`-kind 401
only when `enabled`. So registering a refresher that does nothing but report is what turns a
401 into a callback — skipping registration would mean no callback at all.

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/provider-external-session.test.tsx`, inside the
`customerSession='external'` describe:

```tsx
  it("reports a 401 through onCustomerSessionExpired and issues no refresh request", async () => {
    let expired = 0;
    let refreshCalls = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", () =>
        HttpResponse.json({ message: "expired" }, { status: 401 }),
      ),
      // customers.refresh is a GET on /customer/{tenant}/refreshauthtoken
      // (packages/sdk/src/services/customer.ts:160) — not a POST.
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () => {
        refreshCalls += 1;
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const storage = createMemoryStorage();
    // A refresh token IS present — the point is that external mode ignores it.
    storage.setRefreshToken("rt-1");

    renderHook(() => useEmporix(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <EmporixProvider
          client={c}
          queryClient={qc}
          storage={storage}
          customerSession="external"
          initialCustomerToken="host-1"
          onCustomerSessionExpired={() => {
            expired += 1;
          }}
        >
          {children}
        </EmporixProvider>
      ),
    });

    await expect(
      c.products.get("p1", undefined, { kind: "customer", token: "host-1" }),
    ).rejects.toThrow();
    await waitFor(() => expect(expired).toBe(1));
    expect(refreshCalls).toBe(0);
  });
```

And a second test for the contradictory-props warning, in the same describe:

```tsx
  it("warns when autoRefreshCustomerToken is combined with external mode", () => {
    const warnings: unknown[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      warnings.push(args[0]);
    });
    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useEmporix(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <EmporixProvider
          client={c}
          queryClient={qc}
          customerSession="external"
          initialCustomerToken="host-1"
          autoRefreshCustomerToken
        >
          {children}
        </EmporixProvider>
      ),
    });
    expect(warnings.some((w) => String(w).includes("autoRefreshCustomerToken is ignored"))).toBe(
      true,
    );
    spy.mockRestore();
  });
```

Add `vi` to the file's `vitest` import.

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm -F @viu/emporix-sdk-react test -- tests/provider-external-session.test.tsx
```

Expected: FAIL on both — `expired` stays `0` because with `autoRefreshCustomerToken` unset
the refresher is never registered, and no warning is emitted because the guard does not
exist yet.

- [ ] **Step 3: Register a report-only refresher in external mode**

In `packages/react/src/hooks/internal/use-customer-token-refresher.ts`, add
`customerSession: "owned" | "external";` to the args interface, destructure it, and make the
effect body begin with the external branch:

```ts
  useEffect(() => {
    if (customerSession === "external") {
      // Report-only. Registering rather than skipping is what makes the callback
      // fire at all: the HTTP layer consults the refresher on a customer 401 and
      // `registry.enabled` is `refresher !== null`. Returning null lets the 401
      // propagate as EmporixAuthError.
      //
      // Deliberately does NOT read storage.getRefreshToken(): reaching the same
      // end state by enabling autoRefreshCustomerToken and relying on an absent
      // refresh token would be an accident of the implementation, not a contract.
      client.setCustomerTokenRefresher({
        refresh: async () => {
          emit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onExpired?.();
          return null;
        },
      });
      return () => client.setCustomerTokenRefresher(null);
    }
    if (!enabled) return;
    // …existing owned-mode body, unchanged…
  }, [enabled, client, storage, emit, onExpired, customerSession]);
```

- [ ] **Step 4: Warn on the contradictory combination**

Still in the same file, immediately above the `useEffect`:

```ts
  // A dev-only guard: the two props state opposite intentions, and silently
  // picking one would hide the mistake.
  if (
    process.env.NODE_ENV !== "production" &&
    customerSession === "external" &&
    enabled === true
  ) {
    console.warn(
      '[emporix] autoRefreshCustomerToken is ignored when customerSession is "external": ' +
        "a host-owned token is never refreshed by the SDK. Remove one of the two props.",
    );
  }
```

- [ ] **Step 5: Pass the mode from the provider**

In `packages/react/src/provider.tsx`, add `customerSession: session,` to the
`useCustomerTokenRefresher({ … })` call.

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk-react test
pnpm typecheck
```

Expected: PASS, `auto-refresh-customer.test.tsx` included and unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/internal/use-customer-token-refresher.ts \
  packages/react/src/provider.tsx packages/react/tests/provider-external-session.test.tsx
git commit -m "feat(react): report an expired external token without refreshing it

onCustomerSessionExpired only fired when autoRefreshCustomerToken was on, which
is exactly wrong for a token the host owns and that has no refresh token. In
external mode a report-only refresher is registered instead, so a customer 401
reaches the callback and then propagates as EmporixAuthError."
```

---

## Task 4: the README recipe for the Managed Dashboard template

**Files:**
- Modify: `packages/react/README.md` (new section after `## Provider`, line 36)
- Modify: `docs/react.md` (provider-prop reference + one bullet under `### Common pitfalls`)
- Modify: `README.md` (root) — one line in whichever list enumerates the packages' use cases

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the Managed Dashboard section to the React README**

In `packages/react/README.md`, after the `## Provider` section (which ends at line 36 with
"never per request/render."), insert:

````markdown
## Managed Dashboard module (host-owned token)

Emporix's [`md-module-template`](https://github.com/emporix/md-module-template) is a Module
Federation remote. The Managed Dashboard loads it and passes one object:

```ts
type AppState = { tenant: string; language: string; token: string }
```

The module never authenticates — that `token` is a customer token whose scopes reach
operations a storefront token could not. `customerSession="external"` is how you tell the
provider so:

```tsx
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "@viu/emporix-sdk-react";

const clients = new Map<string, EmporixClient>();
const clientFor = (tenant: string) => {
  let c = clients.get(tenant);
  if (!c) {
    // No credentials: the host owns the token. `host` must be explicit — the
    // template's VITE_API_URL points at a different environment than the
    // SDK's default.
    c = new EmporixClient({ tenant, host: import.meta.env.VITE_API_URL, credentials: {} });
    clients.set(tenant, c);
  }
  return c;
};

const RemoteComponent = ({ appState }: { appState: AppState }) => (
  <EmporixProvider
    client={clientFor(appState.tenant)}
    initialCustomerToken={appState.token}
    initialLanguage={appState.language}
    customerSession="external"
    onCustomerSessionExpired={() => setSessionDead(true)}
  >
    <YourModule />
  </EmporixProvider>
);
```

Every hook now works on the host's token — including the token-gated ones
(`useOrder`, `useMyOrders`, the cart hooks), which an `auth.raw(...)` per-call override
cannot reach.

**What `customerSession="external"` changes**

| | `"owned"` (default) | `"external"` |
|---|---|---|
| `companies.listMine()` on mount | yes, when a token is present | **never** |
| refresh on a customer 401 | only with `autoRefreshCustomerToken` | **never**; `onCustomerSessionExpired` fires and the 401 propagates |
| a changed `initialCustomerToken` | seeds only an empty slot | **authoritative** — written into storage |

**Five things to get right**

1. **No `storage` prop.** A federation remote runs on the host's origin, so
   `createLocalStorage()` would write `emporix.customerToken` into the dashboard's own
   `localStorage`. The default memory storage ties the token's lifetime to the module's.
2. **Pass `initialLanguage`.** Without it the provider seeds the language from the active
   site *after* mount, which moves the query key and orphans anything already fetched. The
   host already knows the language.
3. **One client per tenant, memoized on tenant — not on the token.** The token is a request
   credential; rebuilding the client on rotation throws away its caches.
4. **Do not pass `initialSiteCode`** unless the token can read sites. It triggers a site
   fetch whose failure is swallowed.
5. **Federation `shared`:** keep `react` and `react-dom` shared with the host — two React
   copies break every hook. Do **not** share `@viu/emporix-sdk`,
   `@viu/emporix-sdk-react` or `@tanstack/react-query`; the host does not know your
   versions, and the module owns its own cache.

A working remote is in [`examples/md-module`](../../examples/md-module).
````

- [ ] **Step 2: Add the prop to the docs/react.md reference and pitfalls**

In `docs/react.md`, under `### Common pitfalls`, add:

```markdown
- **A host-owned token needs `customerSession="external"`** — passing
  `initialCustomerToken` alone still bootstraps a B2B company context from it and leaves
  `onCustomerSessionExpired` silent. External mode turns both off and makes a changed
  `initialCustomerToken` authoritative. See the Managed Dashboard section in
  [`packages/react/README.md`](../packages/react/README.md).
```

- [ ] **Step 3: Point at it from the root README**

The root `README.md` has an Examples table at lines 26–32 (`| Example | Shows |`). Add one
row after the `next-server-first` row, matching the existing phrasing:

```markdown
| [`md-module`](./examples/md-module) | an Emporix **Managed Dashboard module** — the host owns the customer token |
```

- [ ] **Step 4: Verify the links resolve**

```bash
grep -n "md-module" packages/react/README.md README.md examples/README.md
grep -n "customerSession" docs/react.md packages/react/README.md
```

Expected: the README references `examples/md-module` (created in Task 5) and both docs
mention `customerSession`. A relative link that does not resolve is a broken doc, so check
the path depth: from `packages/react/README.md` the example is `../../examples/md-module`.

- [ ] **Step 5: Commit**

```bash
git add packages/react/README.md docs/react.md README.md
git commit -m "docs(react): document the managed dashboard integration"
```

---

## Task 5: `examples/md-module`

**Files:**
- Create: `examples/md-module/package.json`, `vite.config.ts`, `tsconfig.json`,
  `index.html`, `.env.example`, `README.md`,
  `src/main.tsx`, `src/RemoteComponent.tsx`, `src/emporix.ts`, `src/ProductList.tsx`
- Modify: `examples/README.md` (the "I want to see…" table and the run-command table)

**Interfaces:**
- Consumes: `customerSession`, `EXTERNAL_CTX` behaviour from Tasks 1–3.
- Produces: nothing consumed by later tasks.

Two deliberate divergences from the upstream template, both to keep this buildable and
focused:

- **No `@emporix/component-library`.** It did not resolve from the public npm registry, so
  depending on it would make the example unbuildable for anyone without registry access. The
  example uses plain markup; the subject here is the SDK wiring, not the design system.
- **`src/main.tsx` renders the remote directly** with a fake `appState` from env vars, so
  the example runs standalone with `pnpm dev`. The federation build is still configured, so
  the same source is loadable by the real dashboard.

- [ ] **Step 1: Scaffold the package**

`examples/md-module/package.json`:

```json
{
  "name": "@viu/emporix-examples-md-module",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.51.0",
    "@viu/emporix-sdk": "workspace:*",
    "@viu/emporix-sdk-react": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@originjs/vite-plugin-federation": "^1.4.1",
    "@types/react": "^19.2.16",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.7.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.5"
  }
}
```

Copy `tsconfig.json` from `examples/vite-spa/tsconfig.json` verbatim — it already extends the
repo base with the right JSX and DOM settings.

`examples/md-module/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

// The dashboard origin that must be allowed to load remoteEntry.js.
const corsOrigins = ["https://admin.emporix.io"];

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "extension",
      filename: "remoteEntry.js",
      exposes: { "./RemoteComponent": "./src/RemoteComponent" },
      // react/react-dom only. The SDK packages and react-query are bundled into
      // the remote on purpose: the host does not know our versions, and the
      // module owns its own QueryClient and cache lifetime.
      shared: ["react", "react-dom"],
    }),
  ],
  build: { modulePreload: false, target: "esnext", cssCodeSplit: false },
  server: { cors: { origin: corsOrigins, credentials: true } },
  preview: { cors: { origin: corsOrigins, credentials: true } },
});
```

`examples/md-module/.env.example`:

```
# Emporix API base URL — the same variable the upstream template uses.
VITE_API_URL=https://api.emporix.io
# Stand-ins for the values the Managed Dashboard passes as appState.
VITE_DEMO_TENANT=
VITE_DEMO_LANGUAGE=de
VITE_DEMO_TOKEN=
```

Do **not** create `.env.local`; the reader fills it in. Never commit a token.

- [ ] **Step 2: The client factory**

`examples/md-module/src/emporix.ts`:

```ts
import { EmporixClient } from "@viu/emporix-sdk";

const clients = new Map<string, EmporixClient>();

/**
 * One client per tenant, memoized on tenant and NOT on the token: the token is
 * a request credential, and rebuilding the client on rotation would throw away
 * its caches.
 *
 * `credentials: {}` is legal and intended — the host owns the token, so no
 * client-credentials or storefront client id exist. `host` is explicit because
 * the dashboard's dev environment is not the SDK's default host.
 */
export function clientFor(tenant: string): EmporixClient {
  let c = clients.get(tenant);
  if (!c) {
    c = new EmporixClient({
      tenant,
      host: import.meta.env.VITE_API_URL,
      credentials: {},
    });
    clients.set(tenant, c);
  }
  return c;
}
```

- [ ] **Step 3: The remote entry**

`examples/md-module/src/RemoteComponent.tsx`:

```tsx
import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixProvider } from "@viu/emporix-sdk-react";
import { clientFor } from "./emporix";
import { ProductList } from "./ProductList";

/** Exactly the shape the Managed Dashboard passes in. */
export interface AppState {
  tenant: string;
  language: string;
  token: string;
}

export default function RemoteComponent({ appState }: { appState: AppState }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [sessionDead, setSessionDead] = useState(false);

  if (sessionDead) {
    return <p>Your dashboard session expired. Reload the page to continue.</p>;
  }

  return (
    <EmporixProvider
      client={clientFor(appState.tenant)}
      queryClient={queryClient}
      initialCustomerToken={appState.token}
      // The host knows the language. Left unset, the provider seeds it from the
      // active site AFTER mount, which moves the query key and orphans whatever
      // was already fetched.
      initialLanguage={appState.language}
      customerSession="external"
      onCustomerSessionExpired={() => setSessionDead(true)}
    >
      <ProductList />
    </EmporixProvider>
  );
}
```

- [ ] **Step 4: One page that proves the wiring**

`examples/md-module/src/ProductList.tsx`:

```tsx
import { useProducts } from "@viu/emporix-sdk-react";

/**
 * `totalCount: true` asks Emporix for X-Total-Count, so a dashboard table can
 * show "X of Y" and page exactly instead of guessing from a full page.
 */
export function ProductList() {
  const { data, isLoading, error } = useProducts({ pageNumber: 1, pageSize: 20, totalCount: true });

  if (isLoading) return <p>Loading…</p>;
  if (error) return <pre>{String(error)}</pre>;

  return (
    <section>
      <h1>
        Products {data?.totalCount !== undefined ? `(${data.items.length} of ${data.totalCount})` : ""}
      </h1>
      <ul>
        {data?.items.map((p) => (
          <li key={p.id}>{typeof p.name === "string" ? p.name : p.id}</li>
        ))}
      </ul>
    </section>
  );
}
```

`examples/md-module/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RemoteComponent from "./RemoteComponent";

// Stands in for the host. The real dashboard imports ./RemoteComponent through
// module federation and supplies appState itself.
const appState = {
  tenant: import.meta.env.VITE_DEMO_TENANT,
  language: import.meta.env.VITE_DEMO_LANGUAGE,
  token: import.meta.env.VITE_DEMO_TOKEN,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RemoteComponent appState={appState} />
  </StrictMode>,
);
```

`index.html` — copy `examples/vite-spa/index.html` and change the `<title>` to
`Emporix Managed Dashboard module`.

- [ ] **Step 5: Register the example**

Add to the `examples/README.md` "I want to see…" table:

```markdown
| a **Managed Dashboard module** (host-owned token) | [`md-module`](./md-module) | Vite + Module Federation |
```

and to its run-command table:

```markdown
| `md-module` | `pnpm -F @viu/emporix-examples-md-module dev` | `.env.local` — `VITE_API_URL`, `VITE_DEMO_TENANT`, `VITE_DEMO_LANGUAGE`, `VITE_DEMO_TOKEN` |
```

Write `examples/md-module/README.md` stating: what the upstream template is, that this
example diverges by omitting `@emporix/component-library` and by rendering itself for local
dev, how to get a token (from the dashboard session — and that it must go in untracked
`.env.local`), and that `pnpm build` produces `dist/remoteEntry.js`.

- [ ] **Step 6: Install, build and typecheck**

```bash
pnpm install
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-md-module typecheck
pnpm -F @viu/emporix-examples-md-module build
```

Expected: all pass, and the build emits `examples/md-module/dist/remoteEntry.js`. The two SDK
builds first are not optional — examples typecheck against `dist/`, not source.

- [ ] **Step 7: Commit**

```bash
git add examples/md-module examples/README.md pnpm-lock.yaml
git commit -m "docs(examples): add a managed dashboard module remote

A federation remote wired for a host-owned customer token. Omits
@emporix/component-library, which does not resolve from the public npm
registry, and renders itself in dev so it runs standalone."
```

---

## Task 6: changeset, full verification, PR

**Files:**
- Create: the `.changeset/*.md` file `pnpm changeset` generates

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: nothing.

- [ ] **Step 1: Author the changeset**

`pnpm changeset` is interactive; if that is not available, write the file directly in the
repo's format. `@viu/emporix-sdk-react`, **minor**:

```
feat(react): accept a host-owned customer token

`customerSession="external"` tells EmporixProvider that the customer token was
handed in by a host application — an Emporix Managed Dashboard module, an
embedded admin UI. The SDK then never bootstraps a company context from it,
never attempts a refresh, reports a 401 through `onCustomerSessionExpired`, and
treats a changed `initialCustomerToken` as authoritative.

Also fixes a latent bug in the default `"owned"` mode: storage identity no
longer depends on `initialCustomerToken`, so delivering a new token stops
silently discarding `cartId`, `siteCode`, `language` and
`activeLegalEntityId`.
```

`@viu/emporix-sdk` is **not** bumped — nothing under `packages/sdk/src` changed.

- [ ] **Step 2: Run the full verification**

```bash
pnpm -r test
pnpm typecheck
```

Expected: both pass. Paste the real tail of each into the PR body.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add .changeset
git commit -m "docs(release): add the external customer session changeset"
git push origin feat/external-customer-session
gh pr create --base main \
  --title "feat(react): accept a host-owned customer token" \
  --body-file /tmp/pr-external-session-body.md
```

Push over SSH — the `gho_` token works for `gh` API calls but is rejected for git itself.

The PR body must state: the three gaps with file:line, that `"owned"` behaviour is unchanged
and which existing suites prove it (`provider.test.tsx`, `provider-b2b.test.tsx`,
`use-active-company-bootstrap.test.tsx`, `auto-refresh-customer.test.tsx`), the storage-identity
fix as a deliberate behaviour change, why registering a report-only refresher beats enabling
`autoRefreshCustomerToken`, and the two example divergences. It must also carry the spec's
three unverified assumptions — the token's actual scopes, how the host signals a rotation,
and `@emporix/component-library`'s resolvability — as open questions, not as settled facts.

Do **not** merge.

---

## Deliberately not in this plan

- **No `auth.raw` path.** It works for the core SDK, but with a customer token the
  `customer` kind is the honest description, keeps `mode: "customer"` hooks working, and
  avoids the `authKind: "raw"` key namespace.
- **No token refresh in external mode, of any kind.** The host owns the lifecycle.
- **No change to `validateConfig`'s message.** It claims "provide at least one of
  backend/storefront/custom" while only checking the object exists. This design depends on
  that leniency; correcting the text without changing behaviour is a separate fix.
- **No `initialSiteCode` handling for external mode.** The site fetch still uses
  `customer`/`anonymous`, which is correct now that a customer token exists. The README says
  not to pass it unless the token can read sites; making the provider smarter about it needs
  its own measurement.
