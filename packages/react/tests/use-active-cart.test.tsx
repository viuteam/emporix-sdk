import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCart } from "../src/hooks/use-cart";
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

function wrap(
  storage: EmporixStorage = createMemoryStorage(),
  opts: { siteCode?: string } = { siteCode: "main" },
) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: {
        clientId: "sf",
        ...(opts.siteCode !== undefined ? { context: { siteCode: opts.siteCode } } : {}),
      },
    },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useActiveCart", () => {
  it("returns null (not undefined) when storage.cartId is null and create is false", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
    expect(result.current.fetchStatus).toBe("idle");
    // The wrapper exposes the documented `data: null = no cart, create not requested` signal.
    expect(result.current.data).toBeNull();
  });

  it("loads the cart when storage.cartId is set on mount", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/cart-stored", () =>
        HttpResponse.json({ id: "cart-stored", items: [{ id: "i1" }] }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("cart-stored");
    const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.data?.id).toBe("cart-stored"));
    expect(result.current.data?.items).toHaveLength(1);
  });

  it("drops the cart when the stored cart id is cleared (logout / post-order)", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/cart-stored", () =>
        HttpResponse.json({ id: "cart-stored", items: [{ id: "i1" }] }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("cart-stored");
    const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.data?.id).toBe("cart-stored"));
    // Clearing the cart id externally (e.g. logout/checkout) must propagate so
    // the hook stops returning — and refetching — the now-invalid cart.
    act(() => {
      storage.setCartId(null);
    });
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it("bootstraps a new cart with create:true when storage.cartId is null", async () => {
    let getCurrentCall: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        getCurrentCall = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cart-new", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/cart-new", () =>
        HttpResponse.json({ id: "cart-new", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useActiveCart({ create: true }), {
      wrapper: wrap(storage),
    });

    await waitFor(() => expect(storage.getCartId()).toBe("cart-new"));
    expect(getCurrentCall?.get("siteCode")).toBe("main");
    expect(getCurrentCall?.get("create")).toBe("true");
    await waitFor(() => expect(result.current.data?.id).toBe("cart-new"));
  });

  it("forwards type and legalEntityId to getCurrent", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cart-q", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/cart-q", () =>
        HttpResponse.json({ id: "cart-q", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    renderHook(
      () => useActiveCart({ create: true, type: "quote", legalEntityId: "le-1" }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(seenQuery?.get("type")).toBe("quote"));
    expect(seenQuery?.get("legalEntityId")).toBe("le-1");
  });

  it("skips the bootstrap when storefront.context.siteCode is missing", async () => {
    let getCalled = false;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () => {
        getCalled = true;
        return HttpResponse.json({ id: "x", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    renderHook(() => useActiveCart({ create: true }), {
      wrapper: wrap(storage, {}),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(getCalled).toBe(false);
    expect(storage.getCartId()).toBeNull();
  });

  it("does not call getCurrent when an existing cartId is in storage", async () => {
    let getCurrentCalled = false;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () => {
        getCurrentCalled = true;
        return HttpResponse.json({ id: "should-not-be-used", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/existing-cart", () =>
        HttpResponse.json({ id: "existing-cart", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("existing-cart");
    const { result } = renderHook(() => useActiveCart({ create: true }), {
      wrapper: wrap(storage),
    });
    await waitFor(() => expect(result.current.data?.id).toBe("existing-cart"));
    expect(getCurrentCalled).toBe(false);
  });

  it("uses customer auth when a token is stored", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ id: "cust-cart", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/cust-cart", () =>
        HttpResponse.json({ id: "cust-cart", items: [] }),
      ),
    );
    const storage = createMemoryStorage({ initial: "CUST-TOK" });
    renderHook(() => useActiveCart({ create: true }), { wrapper: wrap(storage) });
    await waitFor(() => expect(storage.getCartId()).toBe("cust-cart"));
    expect(seenAuth).toBe("Bearer CUST-TOK");
  });

  it("surfaces errors from carts.get without crashing", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/stale-cart", () =>
        HttpResponse.json({ message: "not found" }, { status: 404 }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("stale-cart");
    const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("two parallel useActiveCart({create:true}) under the same provider share one bootstrap call", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () => {
        calls += 1;
        return HttpResponse.json({ id: "cart-shared", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/cart-shared", () =>
        HttpResponse.json({ id: "cart-shared", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    const wrapper = wrap(storage);
    // Two parallel mounts of useActiveCart({create:true}) in the same provider.
    const { result } = renderHook(
      () => ({
        a: useActiveCart({ create: true }),
        b: useActiveCart({ create: true }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.a.data?.id).toBe("cart-shared"));
    await waitFor(() => expect(result.current.b.data?.id).toBe("cart-shared"));
    // Only one bootstrap call to /cart/.../carts, not two.
    expect(calls).toBe(1);
  });
});
