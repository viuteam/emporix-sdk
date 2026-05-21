# Customer Account Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new hooks to `@viu/emporix-sdk-react` covering the customer-account methods that are uncovered today: `useUpdateCustomer`, `useChangePassword`, `useCustomerAddresses`, `useAddressMutations`, `usePasswordReset`. Extract the existing `customerOnlyCtx` from `use-checkout.ts` into the shared internal helper so all six customer-bound hooks use the same auth pattern.

**Architecture:** Three new domain-named files (`use-customer-profile.ts`, `use-customer-addresses.ts`, `use-password-reset.ts`). The customer-bound mutations re-use a shared `useCustomerOnlyCtx` helper extracted into `hooks/internal/use-read-auth.ts`. Cache invalidation: profile-mutations invalidate `customer.me`; address-mutations invalidate `customer.addresses`. Password-reset is anonymous-only.

**Tech Stack:** TypeScript, Vitest, MSW, TanStack React Query v5.

**Context for the engineer:**

- Read the spec first: `docs/superpowers/specs/2026-05-21-customer-account-hooks-design.md`.
- Branch: `feat/customer-account-hooks` (already created off `main`).
- Allowed commit scopes (commitlint): `customer` is on the allowlist — use `feat(customer): …` for the hooks, `refactor(checkout): …` for the moved helper, `docs(docs): …` for the changeset.
- Pre-commit hook runs typecheck + lint + tests. Each commit should leave the repo green.

---

## File Structure

| File | Change |
|---|---|
| `packages/react/src/hooks/internal/use-read-auth.ts` | Add `useCustomerOnlyCtx` helper |
| `packages/react/src/hooks/use-checkout.ts` | Replace local `customerOnlyCtx` with shared helper |
| `packages/react/src/hooks/use-customer-profile.ts` | **CREATE** — useUpdateCustomer, useChangePassword |
| `packages/react/src/hooks/use-customer-addresses.ts` | **CREATE** — useCustomerAddresses, useAddressMutations |
| `packages/react/src/hooks/use-password-reset.ts` | **CREATE** — usePasswordReset |
| `packages/react/src/hooks/index.ts` | Re-export all new symbols |
| `packages/react/src/index.ts` | Re-export all new symbols at package root |
| `packages/react/tests/use-customer-profile.test.tsx` | **CREATE** — 5 tests |
| `packages/react/tests/use-customer-addresses.test.tsx` | **CREATE** — 6 tests |
| `packages/react/tests/use-password-reset.test.tsx` | **CREATE** — 3 tests |
| `.changeset/customer-account-hooks.md` | Minor changeset |
| `docs/react.md` | Document new hooks under "Customer Account" |

---

## Task 1: Extract `useCustomerOnlyCtx` to shared helper

**Files:**
- Modify: `packages/react/src/hooks/internal/use-read-auth.ts`
- Modify: `packages/react/src/hooks/use-checkout.ts`

- [ ] **Step 1: Add helper to `use-read-auth.ts`**

Append to `packages/react/src/hooks/internal/use-read-auth.ts`:

```typescript
/**
 * Returns a customer `AuthContext` from the stored token. Throws if no token
 * exists in storage — use for hooks that are intentionally customer-only
 * (e.g. profile updates, password change, address management, payment modes).
 */
export function useCustomerOnlyCtx(): AuthContext {
  const { storage } = useEmporix();
  const token = storage.getCustomerToken();
  if (!token) {
    throw new Error("Requires a logged-in customer (no token in storage)");
  }
  return auth.customer(token);
}
```

- [ ] **Step 2: Replace local helper in `use-checkout.ts`**

In `packages/react/src/hooks/use-checkout.ts`:

Remove the local `customerOnlyCtx` function (it's defined near the top — verify with `grep -n customerOnlyCtx packages/react/src/hooks/use-checkout.ts`).

Replace usage sites — the local `customerOnlyCtx(token)` calls become a hook call. Since this changes when the helper runs, follow this pattern in `usePaymentModes`:

```typescript
// before
const token = storage.getCustomerToken();
// ... uses customerOnlyCtx(token) inside queryFn

// after
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
// hook body:
const token = storage.getCustomerToken();
const customerCtx = token ? useCustomerOnlyCtx() : null;
// queryFn becomes: () => client.payments.listPaymentModes(customerCtx as AuthContext)
// query stays `enabled: token !== null` so customerCtx is non-null when it runs
```

Add the import; remove the local helper definition; update the call site.

- [ ] **Step 3: Build SDK so package's type resolution picks up changes**

Run: `pnpm -F @viu/emporix-sdk build`

- [ ] **Step 4: Run existing tests**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: all green (refactor is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/internal/use-read-auth.ts packages/react/src/hooks/use-checkout.ts
git commit -m "refactor(react): extract useCustomerOnlyCtx to shared internal helper"
```

---

## Task 2: Implement `useUpdateCustomer` + `useChangePassword` with tests

**Files:**
- Create: `packages/react/src/hooks/use-customer-profile.ts`
- Create: `packages/react/tests/use-customer-profile.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-customer-profile.test.tsx`:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useUpdateCustomer,
  useChangePassword,
} from "../src/hooks/use-customer-profile";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage: EmporixStorage = createMemoryStorage({ initial: "cust-tok" })) {
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

describe("useUpdateCustomer", () => {
  it("PUTs the patch and returns the updated Customer", async () => {
    let seenBody: { firstName?: string } | undefined;
    server.use(
      http.put("https://api.emporix.io/customer/acme/me", async ({ request }) => {
        seenBody = (await request.json()) as { firstName?: string };
        return HttpResponse.json({ id: "c1", contactEmail: "a@b.co", firstName: "New" });
      }),
    );
    const { result } = renderHook(() => useUpdateCustomer(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ firstName: "New" });
    });
    expect(seenBody?.firstName).toBe("New");
    expect(result.current.data?.firstName).toBe("New");
  });

  it("invalidates the customer.me query on success", async () => {
    server.use(
      http.put("https://api.emporix.io/customer/acme/me", () =>
        HttpResponse.json({ id: "c1", firstName: "Updated" }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      ["emporix", "customer", "me", { tenant: "acme", hasToken: true }],
      { id: "c1", firstName: "Old" },
    );
    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: ({ children }) => {
        const client = new EmporixClient({
          tenant: "acme",
          credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
          logger: false,
        });
        return (
          <EmporixProvider client={client} storage={createMemoryStorage({ initial: "cust" })} queryClient={qc}>
            {children}
          </EmporixProvider>
        );
      },
    });
    await act(async () => {
      await result.current.mutateAsync({ firstName: "Updated" });
    });
    const state = qc.getQueryState([
      "emporix",
      "customer",
      "me",
      { tenant: "acme", hasToken: true },
    ]);
    expect(state?.isInvalidated).toBe(true);
  });

  it("throws when no customer token is stored", async () => {
    const storage = createMemoryStorage(); // no token
    expect(() => renderHook(() => useUpdateCustomer(), { wrapper: wrap(storage) })).toThrow(
      /logged-in customer/,
    );
  });
});

describe("useChangePassword", () => {
  it("PUTs the input and resolves to void", async () => {
    let seenBody: { currentPassword?: string; newPassword?: string } | undefined;
    server.use(
      http.put(
        "https://api.emporix.io/customer/acme/password",
        async ({ request }) => {
          seenBody = (await request.json()) as { currentPassword?: string; newPassword?: string };
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const { result } = renderHook(() => useChangePassword(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ currentPassword: "old", newPassword: "new" });
    });
    expect(seenBody?.currentPassword).toBe("old");
    expect(seenBody?.newPassword).toBe("new");
    expect(result.current.isSuccess).toBe(true);
  });

  it("throws when no customer token is stored", () => {
    const storage = createMemoryStorage(); // no token
    expect(() => renderHook(() => useChangePassword(), { wrapper: wrap(storage) })).toThrow(
      /logged-in customer/,
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-profile`
Expected: 5 failures — module not found.

- [ ] **Step 3: Implement the hooks**

Create `packages/react/src/hooks/use-customer-profile.ts`:

```typescript
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import {
  type Customer,
  type CustomerUpdateInput,
  type PasswordChangeInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";

/** Updates the logged-in customer's profile and invalidates the `me` query. */
export function useUpdateCustomer(): UseMutationResult<Customer, unknown, CustomerUpdateInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation<Customer, unknown, CustomerUpdateInput>({
    mutationFn: (patch) => client.customers.update(patch, ctx),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["emporix", "customer", "me"] });
    },
  });
}

/** Changes the customer's password. No cache invalidation — no read query
 *  surfaces the password. */
export function useChangePassword(): UseMutationResult<void, unknown, PasswordChangeInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useMutation<void, unknown, PasswordChangeInput>({
    mutationFn: (input) => client.customers.changePassword(input, ctx),
  });
}
```

- [ ] **Step 4: Build SDK + run tests**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test -- use-customer-profile
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-customer-profile.ts packages/react/tests/use-customer-profile.test.tsx
git commit -m "feat(customer): add useUpdateCustomer and useChangePassword"
```

---

## Task 3: Implement `useCustomerAddresses` + `useAddressMutations` with tests

**Files:**
- Create: `packages/react/src/hooks/use-customer-addresses.ts`
- Create: `packages/react/tests/use-customer-addresses.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-customer-addresses.test.tsx`:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useCustomerAddresses,
  useAddressMutations,
} from "../src/hooks/use-customer-addresses";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage: EmporixStorage = createMemoryStorage({ initial: "cust" })) {
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

describe("useCustomerAddresses", () => {
  it("is disabled when no customer token", () => {
    const storage = createMemoryStorage(); // no token
    const { result } = renderHook(() => useCustomerAddresses(), { wrapper: wrap(storage) });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("returns the address list with customer auth", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer/acme/me/addresses", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { id: "a1", street: "Main St" },
          { id: "a2", street: "Side Rd" },
        ]);
      }),
    );
    const { result } = renderHook(() => useCustomerAddresses(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(seenAuth).toBe("Bearer cust");
  });
});

describe("useAddressMutations", () => {
  it("add POSTs and returns the new Address", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/me/addresses", () =>
        HttpResponse.json({ id: "a3", street: "New St" }),
      ),
    );
    const { result } = renderHook(() => useAddressMutations(), { wrapper: wrap() });
    await act(async () => {
      await result.current.add.mutateAsync({ street: "New St" } as never);
    });
    expect(result.current.add.data?.id).toBe("a3");
  });

  it("update PUTs the patch on the id-path", async () => {
    let seenBody: { city?: string } | undefined;
    server.use(
      http.put(
        "https://api.emporix.io/customer/acme/me/addresses/a1",
        async ({ request }) => {
          seenBody = (await request.json()) as { city?: string };
          return HttpResponse.json({ id: "a1", city: "Updated" });
        },
      ),
    );
    const { result } = renderHook(() => useAddressMutations(), { wrapper: wrap() });
    await act(async () => {
      await result.current.update.mutateAsync({ id: "a1", patch: { city: "Updated" } as never });
    });
    expect(seenBody?.city).toBe("Updated");
    expect(result.current.update.data?.id).toBe("a1");
  });

  it("remove DELETEs the id and resolves to void", async () => {
    server.use(
      http.delete("https://api.emporix.io/customer/acme/me/addresses/a1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(() => useAddressMutations(), { wrapper: wrap() });
    await act(async () => {
      await result.current.remove.mutateAsync({ id: "a1" });
    });
    expect(result.current.remove.isSuccess).toBe(true);
  });

  it("a successful mutation invalidates the addresses query", async () => {
    let listCallCount = 0;
    server.use(
      http.get("https://api.emporix.io/customer/acme/me/addresses", () => {
        listCallCount += 1;
        return HttpResponse.json([{ id: "a1" }]);
      }),
      http.post("https://api.emporix.io/customer/acme/me/addresses", () =>
        HttpResponse.json({ id: "a2" }),
      ),
    );
    const { result } = renderHook(
      () => ({ list: useCustomerAddresses(), mut: useAddressMutations() }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBe(1));
    expect(listCallCount).toBe(1);
    await act(async () => {
      await result.current.mut.add.mutateAsync({ street: "X" } as never);
    });
    await waitFor(() => expect(listCallCount).toBe(2));
  });

  it("throws when no customer token", () => {
    const storage = createMemoryStorage();
    expect(() => renderHook(() => useAddressMutations(), { wrapper: wrap(storage) })).toThrow(
      /logged-in customer/,
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-addresses`
Expected: 6 failures — module not found.

- [ ] **Step 3: Implement the hooks**

Create `packages/react/src/hooks/use-customer-addresses.ts`:

```typescript
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  type Address,
  type AddressCreateInput,
  type AddressUpdateInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx, type QueryOpts } from "./internal/use-read-auth";

const ADDRESSES_KEY = ["emporix", "customer", "addresses"] as const;

/** Lists the logged-in customer's addresses. Disabled when no token. */
export function useCustomerAddresses(options: QueryOpts = {}): UseQueryResult<Address[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  // Use the override only if explicitly passed; otherwise stay disabled
  // until a customer token shows up.
  return useQuery({
    queryKey: [...ADDRESSES_KEY, { tenant: client.tenant, hasToken: token !== null }],
    enabled: token !== null || options.auth !== undefined,
    queryFn: () => {
      const ctx = options.auth ?? useCustomerOnlyCtx();
      return client.customers.addresses.list(ctx);
    },
  });
}

/** Address CRUD mutations. Each invalidates `customer.addresses` on success. */
export interface AddressMutationsApi {
  add: UseMutationResult<Address, unknown, AddressCreateInput>;
  update: UseMutationResult<Address, unknown, { id: string; patch: AddressUpdateInput }>;
  remove: UseMutationResult<void, unknown, { id: string }>;
}

export function useAddressMutations(): AddressMutationsApi {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ADDRESSES_KEY });
  };

  return {
    add: useMutation<Address, unknown, AddressCreateInput>({
      mutationFn: (input) => client.customers.addresses.add(input, ctx),
      onSuccess: invalidate,
    }),
    update: useMutation<Address, unknown, { id: string; patch: AddressUpdateInput }>({
      mutationFn: ({ id, patch }) => client.customers.addresses.update(id, patch, ctx),
      onSuccess: invalidate,
    }),
    remove: useMutation<void, unknown, { id: string }>({
      mutationFn: ({ id }) => client.customers.addresses.remove(id, ctx),
      onSuccess: invalidate,
    }),
  };
}
```

> The `useCustomerAddresses` design above passes `useCustomerOnlyCtx()` inside the `queryFn`, but that violates React hook rules (hooks at top level only). Replace with this corrected version: read the token + ctx at hook-level, gate by `enabled`:
>
> ```typescript
> export function useCustomerAddresses(options: QueryOpts = {}): UseQueryResult<Address[]> {
>   const { client, storage } = useEmporix();
>   const token = storage.getCustomerToken();
>   const ctx = options.auth ?? (token ? { kind: "customer", token } as const : null);
>   return useQuery({
>     queryKey: [...ADDRESSES_KEY, { tenant: client.tenant, hasToken: token !== null }],
>     enabled: ctx !== null,
>     queryFn: () => client.customers.addresses.list(ctx as AuthContext),
>   });
> }
> ```
>
> Use the corrected version; the first sketch above is illustrative only. Add `import type { AuthContext } from "@viu/emporix-sdk";`.

- [ ] **Step 4: Build SDK + run tests**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test -- use-customer-addresses
```

Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-customer-addresses.ts packages/react/tests/use-customer-addresses.test.tsx
git commit -m "feat(customer): add useCustomerAddresses and useAddressMutations"
```

---

## Task 4: Implement `usePasswordReset` with tests

**Files:**
- Create: `packages/react/src/hooks/use-password-reset.ts`
- Create: `packages/react/tests/use-password-reset.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-password-reset.test.tsx`:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { usePasswordReset } from "../src/hooks/use-password-reset";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  // No customer token — password reset is by definition anonymous.
  const storage = createMemoryStorage();
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

describe("usePasswordReset", () => {
  it("request POSTs with anonymous auth", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/password/reset", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => usePasswordReset(), { wrapper: wrap() });
    await act(async () => {
      await result.current.request.mutateAsync({ email: "u@e.com" } as never);
    });
    expect(seenAuth).toBe("Bearer anon");
    expect(result.current.request.isSuccess).toBe(true);
  });

  it("confirm POSTs with anonymous auth", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post(
        "https://api.emporix.io/customer/acme/password/reset/confirm",
        ({ request }) => {
          seenAuth = request.headers.get("authorization");
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const { result } = renderHook(() => usePasswordReset(), { wrapper: wrap() });
    await act(async () => {
      await result.current.confirm.mutateAsync({
        token: "reset-tok",
        newPassword: "new",
      } as never);
    });
    expect(seenAuth).toBe("Bearer anon");
    expect(result.current.confirm.isSuccess).toBe(true);
  });

  it("works without any customer token in storage", () => {
    const { result } = renderHook(() => usePasswordReset(), { wrapper: wrap() });
    // The mere render must not throw — both request and confirm are available.
    expect(typeof result.current.request.mutateAsync).toBe("function");
    expect(typeof result.current.confirm.mutateAsync).toBe("function");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-password-reset`
Expected: 3 failures.

- [ ] **Step 3: Implement the hook**

Create `packages/react/src/hooks/use-password-reset.ts`:

```typescript
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import {
  auth,
  type PasswordResetRequestInput,
  type PasswordResetConfirmInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/** The 2-step anonymous password-reset flow. `request` triggers the email
 *  with a reset token; `confirm` consumes that token + new password. */
export interface PasswordResetApi {
  request: UseMutationResult<void, unknown, PasswordResetRequestInput>;
  confirm: UseMutationResult<void, unknown, PasswordResetConfirmInput>;
}

export function usePasswordReset(): PasswordResetApi {
  const { client } = useEmporix();
  const anonCtx = auth.anonymous();
  return {
    request: useMutation<void, unknown, PasswordResetRequestInput>({
      mutationFn: (input) => client.customers.requestPasswordReset(input, anonCtx),
    }),
    confirm: useMutation<void, unknown, PasswordResetConfirmInput>({
      mutationFn: (input) => client.customers.confirmPasswordReset(input, anonCtx),
    }),
  };
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-password-reset`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-password-reset.ts packages/react/tests/use-password-reset.test.tsx
git commit -m "feat(customer): add usePasswordReset hook for anonymous reset flow"
```

---

## Task 5: Wire up the barrel + root re-exports

**Files:**
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Append to `hooks/index.ts`**

Add to `packages/react/src/hooks/index.ts`:

```typescript
export { useUpdateCustomer, useChangePassword } from "./use-customer-profile";
export {
  useCustomerAddresses,
  useAddressMutations,
} from "./use-customer-addresses";
export type { AddressMutationsApi } from "./use-customer-addresses";
export { usePasswordReset } from "./use-password-reset";
export type { PasswordResetApi } from "./use-password-reset";
```

- [ ] **Step 2: Update `src/index.ts`**

Add to the hooks re-export list (somewhere after `useCustomerSession`):

```typescript
  useUpdateCustomer,
  useChangePassword,
  useCustomerAddresses,
  useAddressMutations,
  usePasswordReset,
```

And to the type re-exports:

```typescript
export type {
  CustomerSessionApi,
  CartMutationsApi,
  CheckoutApi,
  AddressMutationsApi,
  PasswordResetApi,
} from "./hooks/index";
```

- [ ] **Step 3: Build + typecheck**

```bash
pnpm -F @viu/emporix-sdk-react build
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/hooks/index.ts packages/react/src/index.ts
git commit -m "feat(react): export customer-account hooks from package root"
```

---

## Task 6: Documentation + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/customer-account-hooks.md`

- [ ] **Step 1: Add a "Customer account" section to `docs/react.md`**

After the existing `useCustomerSession` documentation, append:

```markdown
### Customer account

For "My Account" pages, five additional hooks complement `useCustomerSession`:

`useUpdateCustomer()` — mutation to PUT a profile patch. Invalidates `useCustomerSession.customer` on success so the UI re-renders with the new value.

`useChangePassword()` — mutation that PUTs `currentPassword` + `newPassword`. Customer-only; throws on missing token.

`useCustomerAddresses()` — list of the logged-in customer's addresses. Disabled until a customer token is in storage.

`useAddressMutations()` — `{ add, update, remove }` mutations for `customer.addresses.*`. Each invalidates `useCustomerAddresses` on success.

`usePasswordReset()` — the 2-step anonymous flow: `{ request, confirm }`. Use on `/forgot-password` and `/reset-password?token=…` routes. Both mutations are anonymous-auth (the user is locked out by definition).

```tsx
const update = useUpdateCustomer();
await update.mutateAsync({ firstName: "New" });

const { add, update: updateAddr, remove } = useAddressMutations();
await add.mutateAsync({ street: "Main St", city: "Zürich", country: "CH" });

const { request, confirm } = usePasswordReset();
await request.mutateAsync({ email: "u@e.com" });            // step 1
await confirm.mutateAsync({ token: "...", newPassword: "..." }); // step 2
```
```

- [ ] **Step 2: Write the changeset**

Create `.changeset/customer-account-hooks.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Add customer-account hooks to `@viu/emporix-sdk-react`:

- `useUpdateCustomer()` — mutation for profile updates, invalidates `useCustomerSession.customer`.
- `useChangePassword()` — mutation for password change. Customer-only.
- `useCustomerAddresses()` — query for the customer's address list.
- `useAddressMutations()` — `{ add, update, remove }` mutations following the `useCartMutations` shape.
- `usePasswordReset()` — 2-step anonymous flow: `{ request, confirm }`.

Internal: the `customerOnlyCtx` helper from `useCheckout` moves to the shared `hooks/internal/use-read-auth.ts` as `useCustomerOnlyCtx`. `usePaymentModes` uses it too. Pure refactor for that piece; no behavior change.

No SDK change.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/customer-account-hooks.md
git commit -m "docs(docs): document and changeset customer-account hooks"
```

---

## Final Verification

- [ ] **Full repo build + test + typecheck**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```

Expected: all green. React tests should grow by 14 (5 + 6 + 3) — total ~92.

- [ ] **All five hooks exported from the package root**

```bash
node -e "console.log(Object.keys(require('./packages/react/dist/index.cjs')).filter(k => /useUpdate|useChange|useAddress|useCustomerAddr|usePasswordReset/.test(k)).sort())"
```

Expected output: `['useAddressMutations', 'useChangePassword', 'useCustomerAddresses', 'usePasswordReset', 'useUpdateCustomer']`.

- [ ] **Changeset present**

```bash
pnpm changeset status --since=origin/main | tail -5
```

Expected: lists `@viu/emporix-sdk-react: minor` (linked → both packages bump together).

- [ ] **E2E suite still green**

```bash
set -a; source e2e/.env.local; set +a
pnpm e2e
```

Expected: 6/6 pass. The customer-account hooks are not exercised by the existing E2E specs — that's by design (Account-Center UI doesn't exist in vite-spa).

---

## Follow-up (out of scope)

- Example app with "My Account" page demonstrating these hooks — would round out the storefront reference. Can come in a separate PR after these land.
- Optimistic updates on address mutations.
- E2E spec for the address flow on a future Account-Center page.
- Order-history hooks — depend on SDK shipping OrderService first.
- Email-change flow with verification — Emporix has a dedicated endpoint; out of scope here.
