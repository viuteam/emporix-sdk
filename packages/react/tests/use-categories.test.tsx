import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useCategory,
  useCategories,
  useProductsInCategory,
  useProductsInCategoryInfinite,
} from "../src/hooks/use-categories";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/category/acme/categories/c1", () =>
    HttpResponse.json({ id: "c1", name: "Books" }),
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

describe("category hooks", () => {
  it("useCategory fetches a category", async () => {
    const { result } = renderHook(() => useCategory("c1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.name).toBe("Books"));
  });

  it("useCategories returns PaginatedItems<Category>", async () => {
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", () =>
        HttpResponse.json([{ id: "c1" }]),
      ),
    );
    const { result } = renderHook(() => useCategories({ pageNumber: 1, pageSize: 50 }), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([{ id: "c1" }]);
    expect(result.current.data?.hasNextPage).toBe(false);
  });
});

describe("useProductsInCategory", () => {
  it("is disabled without categoryId", () => {
    const { result } = renderHook(() => useProductsInCategory(undefined), {
      wrapper: wrap(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("GETs products by category id with pageSize", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get(
        "https://api.emporix.io/category/acme/categories/c1/products",
        ({ request }) => {
          seenQuery = new URL(request.url).searchParams;
          return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
        },
      ),
    );
    const { result } = renderHook(
      () => useProductsInCategory("c1", { pageSize: 12 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.data?.items?.length).toBe(2));
    expect(seenQuery?.get("pageSize")).toBe("12");
  });
});

describe("useProductsInCategoryInfinite", () => {
  it("is disabled without categoryId", () => {
    const { result } = renderHook(() => useProductsInCategoryInfinite(undefined), {
      wrapper: wrap(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("terminates on hasNextPage=false without trailing empty fetch", async () => {
    let calls = 0;
    server.use(
      http.get(
        "https://api.emporix.io/category/acme/categories/c1/products",
        ({ request }) => {
          calls += 1;
          const page = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
          return page === 1
            ? HttpResponse.json([{ id: "p1" }, { id: "p2" }])
            : HttpResponse.json([{ id: "p3" }]);
        },
      ),
    );
    const { result } = renderHook(
      () => useProductsInCategoryInfinite("c1", { pageSize: 2 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(calls).toBe(2);
    expect(
      result.current.data?.pages.flatMap((p) => p.items).map((p) => p.id),
    ).toEqual(["p1", "p2", "p3"]);
  });
});
