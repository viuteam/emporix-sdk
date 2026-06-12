import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useEmporixQuery } from "../src/hooks/internal/use-emporix-query";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/thing/acme/things/t1", () => HttpResponse.json({ id: "t1" })),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    ),
  };
}

describe("useEmporixQuery", () => {
  it("read-auth mode: keys authKind from resolved context, enabled without a token", async () => {
    const { wrapper, queryClient } = wrap();
    const { result } = renderHook(
      () =>
        useEmporixQuery({
          mode: "read-auth", site: "full", resource: "thing", args: ["t1"],
          queryFn: () => Promise.resolve({ id: "t1" }),
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const key = queryClient.getQueryCache().getAll()[0]!.queryKey;
    expect(key).toEqual(["emporix", "thing", "t1", { tenant: "acme", authKind: "anonymous", siteCode: null, language: null }]);
  });

  it("customer mode: disabled without a token, re-enables reactively on login, keys authKind", async () => {
    const storage = createMemoryStorage();
    const { wrapper, queryClient } = wrap(storage);
    let calls = 0;
    const { result } = renderHook(
      () =>
        useEmporixQuery({
          mode: "customer", site: "none", resource: "mine", args: [],
          queryFn: () => { calls += 1; return Promise.resolve(["x"]); },
        }),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(calls).toBe(0);
    act(() => storage.setCustomerToken("cust"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toBe(1);
    const key = queryClient.getQueryCache().getAll().at(-1)!.queryKey;
    expect(key).toEqual(["emporix", "mine", { tenant: "acme", authKind: "customer" }]);
  });

  it("site fields: 'language' carries only language; 'none' carries neither", async () => {
    const { wrapper, queryClient } = wrap();
    renderHook(
      () =>
        useEmporixQuery({
          mode: "read-auth", site: "language", resource: "ling", args: [1],
          queryFn: () => Promise.resolve(1), enabled: false,
        }),
      { wrapper },
    );
    const key = queryClient.getQueryCache().getAll().find((q) => q.queryKey[1] === "ling")!.queryKey;
    expect(key).toEqual(["emporix", "ling", 1, { tenant: "acme", authKind: "anonymous", language: null }]);
  });

  it("honours an authOverride in read-auth mode", async () => {
    const { wrapper, queryClient } = wrap();
    const { auth } = await import("@viu/emporix-sdk");
    renderHook(
      () =>
        useEmporixQuery({
          mode: "read-auth", site: "none", resource: "ov", args: [],
          authOverride: auth.customer("forced"),
          queryFn: () => Promise.resolve(1), enabled: false,
        }),
      { wrapper },
    );
    const key = queryClient.getQueryCache().getAll().find((q) => q.queryKey[1] === "ov")!.queryKey;
    expect(key).toEqual(["emporix", "ov", { tenant: "acme", authKind: "customer" }]);
  });
});
