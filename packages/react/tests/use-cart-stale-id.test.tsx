import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCart, useCart, useCartMutations } from "../src/hooks/use-cart";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

/**
 * The multi-device case: Emporix allows one open cart per customer per site and
 * a placed order closes it. Every OTHER device still holds that id in its own
 * storage, so its next cart call 404s — and used to stay broken, because
 * `useActiveCart({ create: true })` only bootstraps when the id is `null`.
 */
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

/** `retry` left at the package default on purpose — one test asserts it. */
function wrap(storage: EmporixStorage, queryClient = new QueryClient()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf", context: { siteCode: "main" } },
    },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

/** 404s the given cart id, as a closed cart does. */
function gone(id: string, hits: { n: number }) {
  return http.get(`https://api.emporix.io/cart/acme/carts/${id}`, () => {
    hits.n += 1;
    return HttpResponse.json({ message: "cart not found" }, { status: 404 });
  });
}

describe("a cart closed on another device", () => {
  it("drops the stored id so the shopper is not stuck on a dead cart", async () => {
    const hits = { n: 0 };
    server.use(gone("closed-cart", hits));
    const storage = createMemoryStorage();
    storage.setCartId("closed-cart");

    renderHook(() => useCart(), { wrapper: wrap(storage) });

    await waitFor(() => expect(storage.getCartId()).toBeNull());
  });

  it("bootstraps a fresh cart with create:true, silently", async () => {
    const hits = { n: 0 };
    server.use(
      gone("closed-cart", hits),
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ id: "cart-fresh", items: [] }),
      ),
      http.get("https://api.emporix.io/cart/acme/carts/cart-fresh", () =>
        HttpResponse.json({ id: "cart-fresh", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("closed-cart");

    const { result } = renderHook(() => useActiveCart({ create: true }), {
      wrapper: wrap(storage),
    });

    await waitFor(() => expect(storage.getCartId()).toBe("cart-fresh"));
    await waitFor(() => expect(result.current.data?.id).toBe("cart-fresh"));
    // Silent: the shopper never sees an error, they see an empty bag.
    expect(result.current.isError).toBe(false);
  });

  it("does not retry the 404 — Emporix bills per call", async () => {
    const hits = { n: 0 };
    server.use(gone("closed-cart", hits));
    const storage = createMemoryStorage();
    storage.setCartId("closed-cart");

    renderHook(() => useCart(), { wrapper: wrap(storage) });

    await waitFor(() => expect(storage.getCartId()).toBeNull());
    expect(hits.n).toBe(1);
  });

  it("keeps the id on an error that is not a 404", async () => {
    // Only a 404 means «this cart is gone». Anything else — a permissions
    // problem, a bad gateway — must leave the session's cart alone.
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/my-cart", () =>
        HttpResponse.json({ message: "nope" }, { status: 403 }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("my-cart");

    const { result } = renderHook(() => useCart(), {
      wrapper: wrap(storage, new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(storage.getCartId()).toBe("my-cart");
  });

  it("leaves the stored id alone when the caller passed a foreign cart id", async () => {
    const hits = { n: 0 };
    server.use(gone("someone-elses-cart", hits));
    const storage = createMemoryStorage();
    storage.setCartId("my-cart");

    const { result } = renderHook(() => useCart("someone-elses-cart"), {
      wrapper: wrap(storage, new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(storage.getCartId()).toBe("my-cart");
  });

  it("drops the id when a WRITE hits the closed cart", async () => {
    // The mutate path resolves the id from storage too, so it needs the same
    // cleanup — otherwise every add-to-cart on this device fails forever.
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts/closed-cart/items", () =>
        HttpResponse.json({ message: "cart not found" }, { status: 404 }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("closed-cart");

    const { result } = renderHook(() => useCartMutations(), { wrapper: wrap(storage) });

    await waitFor(() => expect(result.current.addItem.mutate).toBeTypeOf("function"));
    result.current.addItem.mutate({ itemYrn: "urn:x", quantity: 1 } as never);

    await waitFor(() => expect(storage.getCartId()).toBeNull());
  });
});
