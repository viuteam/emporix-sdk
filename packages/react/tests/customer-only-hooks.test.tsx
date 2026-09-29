import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import type { ReactNode } from "react";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyReturns, useReturn, useCreateReturn } from "../src/hooks/use-returns";
import {
  useShoppingLists,
  useCreateShoppingList,
  useDeleteShoppingList,
  useAddToShoppingList,
  useRemoveFromShoppingList,
  useSetShoppingListItemQuantity,
} from "../src/hooks/use-shopping-lists";
import { useApprovals, useApproval, useCreateApproval, useUpdateApproval } from "../src/hooks/use-approvals";
import { useMyRewardPoints, useMyRewardPointsSummary, useRedeemRewardPoints } from "../src/hooks/use-reward-points";
import { useAddressMutations, useAddAddressTags, useRemoveAddressTags } from "../src/hooks/use-customer-addresses";
import { useChangeEmail } from "../src/hooks/use-customer-credentials";
import { useUpdateCustomer, useChangePassword } from "../src/hooks/use-customer-profile";

// Only the provider's guest bootstrap may reach the network.
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A guest by default: no customer token in storage. */
function wrap(storage = createMemoryStorage(), qc = new QueryClient()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

type Mutation = { mutateAsync: (vars: never) => Promise<unknown> };

const READS: [string, () => UseQueryResult<unknown>][] = [
  ["useMyReturns", () => useMyReturns()],
  ["useReturn", () => useReturn("r1")],
  ["useShoppingLists", () => useShoppingLists()],
  ["useApprovals", () => useApprovals()],
  ["useApproval", () => useApproval("ap1")],
  ["useMyRewardPoints", () => useMyRewardPoints()],
  ["useMyRewardPointsSummary", () => useMyRewardPointsSummary()],
];

const MUTATIONS: [string, () => Mutation][] = [
  ["useCreateReturn", () => useCreateReturn()],
  ["useCreateShoppingList", () => useCreateShoppingList()],
  ["useDeleteShoppingList", () => useDeleteShoppingList()],
  ["useAddToShoppingList", () => useAddToShoppingList()],
  ["useRemoveFromShoppingList", () => useRemoveFromShoppingList()],
  ["useSetShoppingListItemQuantity", () => useSetShoppingListItemQuantity()],
  ["useCreateApproval", () => useCreateApproval()],
  ["useUpdateApproval", () => useUpdateApproval()],
  ["useRedeemRewardPoints", () => useRedeemRewardPoints()],
  ["useAddressMutations().add", () => useAddressMutations().add],
  ["useAddressMutations().update", () => useAddressMutations().update],
  ["useAddressMutations().remove", () => useAddressMutations().remove],
  ["useAddAddressTags", () => useAddAddressTags()],
  ["useRemoveAddressTags", () => useRemoveAddressTags()],
  ["useChangeEmail", () => useChangeEmail()],
  ["useUpdateCustomer", () => useUpdateCustomer()],
  ["useChangePassword", () => useChangePassword()],
];

describe("customer-only hooks for a guest", () => {
  it.each(READS)("%s renders and stays idle", (_name, use) => {
    const { result } = renderHook(use, { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it.each(MUTATIONS)("%s renders, and rejects only when run", async (_name, use) => {
    const { result } = renderHook(use, { wrapper: wrap() });
    await act(async () => {
      await expect(result.current.mutateAsync({} as never)).rejects.toThrow(/logged-in customer/);
    });
  });

  it("a mutation reads the token when it runs, not from the render", async () => {
    const storage = createMemoryStorage();
    let seenAuth: string | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/password/change", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useChangePassword(), { wrapper: wrap(storage) });
    const { mutateAsync } = result.current;
    // A login lands between the render and the click, before React re-renders.
    storage.setCustomerToken("fresh");
    await act(() => mutateAsync({ currentPassword: "old", newPassword: "new" }));
    expect(seenAuth).toBe("Bearer fresh");
  });
});

describe("customer-only reads for a signed-in customer", () => {
  it("the by-id reads still wait for an id", () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const ret = renderHook(() => useReturn(undefined), { wrapper: wrap(storage) });
    const approval = renderHook(() => useApproval(undefined), { wrapper: wrap(storage) });
    expect(ret.result.current.fetchStatus).toBe("idle");
    expect(approval.result.current.fetchStatus).toBe("idle");
  });

  // The move to `useEmporixQuery` must not change a signed-in customer's keys:
  // invalidations and prefetches elsewhere address them.
  const KEYS: [string, () => UseQueryResult<unknown>, unknown[], boolean][] = [
    ["useMyReturns", () => useMyReturns(), ["returns", null], false],
    ["useReturn", () => useReturn("r1"), ["returns", "r1"], false],
    ["useShoppingLists", () => useShoppingLists(), ["shopping-lists", null], true],
    ["useApprovals", () => useApprovals(), ["approvals", null], false],
    ["useApproval", () => useApproval("ap1"), ["approvals", "ap1"], false],
    ["useMyRewardPoints", () => useMyRewardPoints(), ["reward-points", "mine"], false],
    ["useMyRewardPointsSummary", () => useMyRewardPointsSummary(), ["reward-points", "mine", "summary"], false],
  ];

  it.each(KEYS)("%s keeps its cache key", (_name, use, parts, siteScoped) => {
    // Every resource request hangs; only the key matters here.
    server.use(http.all("https://api.emporix.io/:any*", () => new Promise<never>(() => {})));
    const qc = new QueryClient();
    renderHook(use, { wrapper: wrap(createMemoryStorage({ initial: "cust" }), qc) });
    const key = qc.getQueryCache().getAll().find((q) => q.queryKey[1] === parts[0])?.queryKey ?? [];
    expect(key.slice(0, -1)).toEqual(["emporix", ...parts]);
    const meta = key[key.length - 1] as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(
      siteScoped ? ["authKind", "language", "siteCode", "tenant"] : ["authKind", "tenant"],
    );
    expect(meta).toMatchObject({ tenant: "acme", authKind: "customer" });
  });
});
