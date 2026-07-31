import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useAvailability } from "../src/hooks/use-availability";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "r",
      sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/availability/viu/availability/p1/main", () =>
    HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Unlike the sibling file's harness, this one exposes the QueryClient. */
function harness(storedToken: string | null) {
  const client = new EmporixClient({
    tenant: "viu",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const storage = createMemoryStorage(storedToken ? { initial: storedToken } : {});
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

const keyOf = (qc: QueryClient): readonly unknown[] =>
  qc
    .getQueryCache()
    .getAll()
    .find((q) => q.queryKey[1] === "availability")!.queryKey;

describe("useAvailability — key shape", () => {
  it("keys through emporixKey with authKind, not a boolean anon flag", async () => {
    const { wrapper, queryClient } = harness(null);

    const { result } = renderHook(() => useAvailability("p1", "main"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(keyOf(queryClient)).toEqual([
      "emporix",
      "availability",
      "p1",
      "main",
      false,
      { tenant: "viu", authKind: "anonymous" },
    ]);
  });

  it("keys authKind customer when a customerToken option is passed", () => {
    const { wrapper, queryClient } = harness(null);

    renderHook(() => useAvailability("p1", "main", { customerToken: "cust", enabled: false }), {
      wrapper,
    });

    expect(keyOf(queryClient)).toEqual([
      "emporix",
      "availability",
      "p1",
      "main",
      false,
      { tenant: "viu", authKind: "customer" },
    ]);
  });

  it("a STORED customer token does not change the auth — semantics are unchanged", () => {
    // This is the regression guard for the whole change: switching to
    // useEmporixQuery without always passing authOverride would make this
    // resolve to "customer" and start serving personalized availability.
    const { wrapper, queryClient } = harness("stored-cust");

    renderHook(() => useAvailability("p1", "main", { enabled: false }), { wrapper });

    expect(keyOf(queryClient)).toEqual([
      "emporix",
      "availability",
      "p1",
      "main",
      false,
      { tenant: "viu", authKind: "anonymous" },
    ]);
  });

  it("defaultAvailableOnNotFound is part of the key", () => {
    const { wrapper, queryClient } = harness(null);

    renderHook(
      () => useAvailability("p1", "main", { defaultAvailableOnNotFound: true, enabled: false }),
      { wrapper },
    );

    expect(keyOf(queryClient)[4]).toBe(true);
  });
});
