import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCart, useCartMutations, useCreateCart, useActiveCart } from "../src/hooks/use-cart";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

let addShouldFail = false;
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.post("https://api.emporix.io/cart/acme/carts/cart1/items", () =>
    addShouldFail
      ? HttpResponse.json({ message: "no" }, { status: 422 })
      : HttpResponse.json({ id: "cart1", items: [{ id: "i1", productId: "p1" }] }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  addShouldFail = false;
});
afterAll(() => server.close());

function wrap(storage: EmporixStorage = createMemoryStorage()) {
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

describe("useCartMutations", () => {
  it("addItem updates the cart cache", async () => {
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.id).toBe("cart1"));
    await act(async () => {
      await result.current.mut.addItem.mutateAsync({ product: { id: "p1" }, quantity: 1, price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" } });
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(1));
  });

  it("rolls back the optimistic update on error", async () => {
    addShouldFail = true;
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(0));
    await act(async () => {
      await result.current.mut.addItem
        .mutateAsync({ product: { id: "p1" }, quantity: 1, price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" } })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(0));
  });

  it("optimistic add falls back when the product has no id", async () => {
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.id).toBe("cart1"));
    await act(async () => {
      await result.current.mut.addItem.mutateAsync({
        product: {},
        quantity: 1,
        price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
      });
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(1));
  });

  it("updateItem with a 204 No Content response refetches so the UI updates", async () => {
    // A partial quantity update returns `204 No Content` on Emporix — the SDK
    // resolves that to `undefined`. The mutation must NOT clobber the cache
    // with the empty body (setQueryData(undefined) is a no-op → stale UI); it
    // must refetch so the new quantity shows.
    let qty = 1;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
        HttpResponse.json({ id: "cart1", items: [{ id: "i1", quantity: qty }] }),
      ),
      http.put("https://api.emporix.io/cart/acme/carts/cart1/items/i1", () => {
        qty = 5;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    const readQty = () =>
      (result.current.cart.data?.items?.[0] as { quantity?: number } | undefined)?.quantity;
    await waitFor(() => expect(readQty()).toBe(1));
    await act(async () => {
      await result.current.mut.updateItem.mutateAsync({
        itemId: "i1",
        patch: { quantity: 5 } as never,
        partial: true,
      });
    });
    await waitFor(() => expect(readQty()).toBe(5));
  });

  it("useCartMutations() throws when storage has no cartId at mutate-time", async () => {
    const { result } = renderHook(() => useCartMutations(), { wrapper: wrap() });
    await expect(
      result.current.addItem.mutateAsync({
        product: { id: "p1" },
        quantity: 1,
        price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
      }),
    ).rejects.toThrow(/no cartId available/);
  });

  it("useCartMutations() resolves cartId at mutate-time (storage set after mount)", async () => {
    const storage = createMemoryStorage();
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCartMutations(), { wrapper });
    // Render the hook with no cartId — then set storage before mutating.
    storage.setCartId("cart1");
    await act(async () => {
      await result.current.addItem.mutateAsync({
        product: { id: "p1" },
        quantity: 1,
        price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
      });
    });
    // Reaches the existing MSW handler at /cart/acme/carts/cart1/items → success
    // means the mutation picked up the post-mount setCartId.
    await waitFor(() => expect(result.current.addItem.isSuccess).toBe(true));
  });
});

describe("useCreateCart", () => {
  it("creates an anonymous cart and persists cartId in storage", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(
          { cartId: "cart-new", yrn: "yrn:cart:cart-new" },
          { status: 201 },
        );
      }),
    );
    const storage = createMemoryStorage();
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCreateCart(), { wrapper });

    let returned: { cartId?: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ currency: "CHF" });
    });

    expect(returned?.cartId).toBe("cart-new");
    expect(storage.getCartId()).toBe("cart-new");
    expect(seenAuth).toBe("Bearer anon");
  });

  it("uses the customer token when one is stored", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(
          { cartId: "cart-c", yrn: "yrn:cart:cart-c" },
          { status: 201 },
        );
      }),
    );
    const storage = createMemoryStorage({ initial: "CUST-TOK" });
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCreateCart(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ currency: "CHF" });
    });
    expect(seenAuth).toBe("Bearer CUST-TOK");
    expect(storage.getCartId()).toBe("cart-c");
  });

  it("invalidates [emporix,cart] queries on success", async () => {
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ cartId: "cart-new", yrn: "yrn:cart:cart-new" }, { status: 201 }),
      ),
    );
    const storage = createMemoryStorage();
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useCreateCart(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ currency: "CHF" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["emporix", "cart"] }),
    );
  });
});

describe("useCart (read)", () => {
  it("is disabled without a cartId", () => {
    const { result } = renderHook(() => useCart(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("uses customer auth when a token is stored", async () => {
    const storage = createMemoryStorage({ initial: "cust-tok" });
    const { result } = renderHook(() => useCart("cart1"), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.data?.id).toBe("cart1"));
  });

  it("useCart() with no argument is disabled when storage has no cartId", () => {
    const { result } = renderHook(() => useCart(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useCart() with no argument reads cartId from storage", async () => {
    const storage = createMemoryStorage();
    storage.setCartId("cart1");
    const { result } = renderHook(() => useCart(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.data?.id).toBe("cart1"));
  });
});

describe("useActiveCart + useCart cache sharing", () => {
  it("useActiveCart and useCart share the cache when both target the same cart", async () => {
    let cartFetches = 0;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/cart-shared", () => {
        cartFetches += 1;
        return HttpResponse.json({ id: "cart-shared", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    storage.setCartId("cart-shared");
    const wrapper = wrap(storage);
    const { result } = renderHook(
      () => ({ active: useActiveCart(), explicit: useCart("cart-shared") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.active.data?.id).toBe("cart-shared"));
    await waitFor(() => expect(result.current.explicit.data?.id).toBe("cart-shared"));
    expect(cartFetches).toBe(1);
  });

  it("optimistic update from useCartMutations propagates to useActiveCart", async () => {
    const storage = createMemoryStorage();
    storage.setCartId("cart1");
    const wrapper = wrap(storage);
    const { result } = renderHook(
      () => ({ active: useActiveCart(), mut: useCartMutations() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.active.data?.id).toBe("cart1"));
    expect(result.current.active.data?.items).toHaveLength(0);
    await act(async () => {
      await result.current.mut.addItem.mutateAsync({
        product: { id: "p1" },
        quantity: 1,
        price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
      });
    });
    // After mutation, useActiveCart reflects the updated cart from the shared cache.
    await waitFor(() => expect(result.current.active.data?.items).toHaveLength(1));
  });
});
