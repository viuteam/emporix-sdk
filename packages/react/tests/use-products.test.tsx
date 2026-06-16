import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useProduct,
  useProducts,
  useProductsInfinite,
  useProductByCode,
  useProductSearch,
  useProductNameSearch,
  useProductsByCodes,
} from "../src/hooks/use-products";
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

describe("product hooks", () => {
  it("useProduct fetches anonymously by default", async () => {
    const { result } = renderHook(() => useProduct("p1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.name).toBe("Widget"));
  });

  it("useProducts returns PaginatedItems<Product>", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", () =>
        HttpResponse.json([{ id: "p1" }, { id: "p2" }]),
      ),
    );
    const { result } = renderHook(() => useProducts({ pageNumber: 1, pageSize: 2 }), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      items: [{ id: "p1" }, { id: "p2" }],
      pageNumber: 1,
      pageSize: 2,
      hasNextPage: true,
    });
  });

  it("useProductsInfinite terminates on hasNextPage=false without a trailing empty fetch", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        calls += 1;
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        return page === 1
          ? HttpResponse.json([{ id: "p1" }, { id: "p2" }])
          : HttpResponse.json([{ id: "p3" }]);
      }),
    );
    const { result } = renderHook(() => useProductsInfinite({ pageSize: 2 }), { wrapper: wrap() });
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

describe("useProductByCode", () => {
  it("is disabled when code is undefined", () => {
    const { result } = renderHook(() => useProductByCode(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches the product by code", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe("code:T-SHIRT");
        return HttpResponse.json([{ id: "p1", code: "T-SHIRT", name: "Shirt" }]);
      }),
    );
    const { result } = renderHook(() => useProductByCode("T-SHIRT"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.code).toBe("T-SHIRT"));
  });
});

describe("useProductSearch", () => {
  it("is disabled on empty query", () => {
    const { result } = renderHook(() => useProductSearch(""), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("forwards query and pagination params", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
      }),
    );
    const { result } = renderHook(
      () => useProductSearch("shirt", { pageNumber: 1, pageSize: 10 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.data?.items?.length).toBe(2));
    expect(seenQuery?.get("q")).toBe("shirt");
    expect(seenQuery?.get("pageSize")).toBe("10");
  });

  it("accepts a built filter and sends its string as q", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }]);
      }),
    );
    const filter = { toString: () => "mixins.attrs.color:Blue", usesCompound: false };
    const { result } = renderHook(() => useProductSearch(filter), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.items?.length).toBe(1));
    expect(seenQuery?.get("q")).toBe("mixins.attrs.color:Blue");
  });
});

describe("useProducts — site-isolation (MS-2)", () => {
  it("two providers with different initialSiteCode yield separate cache entries", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", () => {
        calls += 1;
        return HttpResponse.json([{ id: `p-${calls}` }]);
      }),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });

    // Site A: own QueryClient, own provider.
    const qcA = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapA = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={qcA} initialSiteCode="A">
        {children}
      </EmporixProvider>
    );
    const { result: rA } = renderHook(() => useProducts({ pageSize: 5 }), { wrapper: wrapA });
    await waitFor(() => expect(rA.current.isSuccess).toBe(true));
    expect(calls).toBe(1);

    // Site B: separate QueryClient and provider — different siteCode means a fresh fetch.
    const qcB = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapB = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={qcB} initialSiteCode="B">
        {children}
      </EmporixProvider>
    );
    const { result: rB } = renderHook(() => useProducts({ pageSize: 5 }), { wrapper: wrapB });
    await waitFor(() => expect(rB.current.isSuccess).toBe(true));
    expect(calls).toBe(2);
  });
});

describe("useProductsByCodes", () => {
  it("is disabled when codes is empty", () => {
    const { result } = renderHook(() => useProductsByCodes([]), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches products for the given codes", async () => {
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        const body = (await request.json()) as { q: string };
        expect(body.q).toBe("code:(A,B)");
        return HttpResponse.json([
          { id: "1", code: "A" },
          { id: "2", code: "B" },
        ]);
      }),
    );
    const { result } = renderHook(() => useProductsByCodes(["A", "B"]), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((p) => p.code)).toEqual(["A", "B"]);
  });
});

describe("useProductNameSearch", () => {
  it("builds a name:(~…) filter from a free-text term", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }]);
      }),
    );
    const { result } = renderHook(() => useProductNameSearch("in time"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((seen as URLSearchParams | null)?.get("q")).toBe("name:(~in time)");
  });

  it("is disabled for an empty term", () => {
    const { result } = renderHook(() => useProductNameSearch(""), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
