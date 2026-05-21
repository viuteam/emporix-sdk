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
    const storage = createMemoryStorage();
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
    let returned: { id?: string } | undefined;
    await act(async () => {
      returned = await result.current.add.mutateAsync({ street: "New St" } as never);
    });
    expect(returned?.id).toBe("a3");
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
    let returned: { id?: string } | undefined;
    await act(async () => {
      returned = await result.current.update.mutateAsync({
        id: "a1",
        patch: { city: "Updated" } as never,
      });
    });
    expect(seenBody?.city).toBe("Updated");
    expect(returned?.id).toBe("a1");
  });

  it("remove DELETEs the id and resolves to void", async () => {
    server.use(
      http.delete(
        "https://api.emporix.io/customer/acme/me/addresses/a1",
        () => new HttpResponse(null, { status: 204 }),
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
