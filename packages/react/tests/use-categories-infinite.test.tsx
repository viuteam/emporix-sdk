import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCategoriesInfinite } from "../src/hooks/queries";
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

describe("useCategoriesInfinite", () => {
  it("fetches page 1, then page 2 via fetchNextPage; terminates on hasNextPage=false", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        calls += 1;
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        return page === 1
          ? HttpResponse.json([{ id: "c1" }, { id: "c2" }])
          : HttpResponse.json([{ id: "c3" }]);
      }),
    );
    const { result } = renderHook(() => useCategoriesInfinite({ pageSize: 2 }), { wrapper: wrap() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));

    expect(calls).toBe(2);
    expect(result.current.data?.pages.flatMap((p) => p.items).map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("does not fetch a trailing empty page when the only page is short", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", () => {
        calls += 1;
        return HttpResponse.json([{ id: "c1" }]);
      }),
    );
    const { result } = renderHook(() => useCategoriesInfinite({ pageSize: 2 }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
    expect(calls).toBe(1);
  });
});
