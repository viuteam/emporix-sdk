import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  EmporixClient,
  EmporixNotFoundError,
  type CartCommand,
  type CartItemInput,
  type CartItemUpdate,
} from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCart, useCartCommands, useCartMutations } from "../src/hooks/use-cart";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const CART = "https://api.emporix.io/cart/acme/carts/cart1";
let gets = 0;
let lastUrl = "";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get(CART, () => {
    gets += 1;
    return HttpResponse.json({ id: "cart1", items: [] });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  gets = 0;
  lastUrl = "";
});
afterAll(() => server.close());

/** Answers the chain with `results`, as Emporix does: HTTP 207. */
function answer(results: unknown[]): void {
  server.use(
    http.post(`${CART}/execute`, ({ request }) => {
      lastUrl = request.url;
      return HttpResponse.json({ results }, { status: 207 });
    }),
  );
}

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

const item: CartItemInput = {
  itemYrn: "urn:yaas:saasag:caasproduct:product:acme;p1",
  quantity: 2,
  price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "CHF" },
};
const add: CartCommand = { type: "AddCartItem", data: item };
const getCart: CartCommand = { type: "GetCart" };
const added = { index: 0, type: "AddCartItem", code: 201, status: "Created", data: { itemId: "3", yrn: "y" } };
const fresh = { id: "cart1", items: [{ id: "3", quantity: 2 }] };

/** Renders a cart view next to the hook and waits for the first cart read. */
async function mounted(storage?: EmporixStorage) {
  const { result } = renderHook(
    () => ({ cart: useCart("cart1"), chain: useCartCommands("cart1") }),
    { wrapper: wrap(storage) },
  );
  await waitFor(() => expect(result.current.cart.data?.id).toBe("cart1"));
  expect(gets).toBe(1);
  return result;
}

/** Gives a refetch that must not happen the chance to happen. */
const quiet = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

describe("useCartCommands", () => {
  it("adopts the cart a chain ends with, without a second request", async () => {
    answer([added, { index: 1, type: "GetCart", code: 200, status: "OK", data: fresh }]);
    const result = await mounted();
    await act(async () => {
      await result.current.chain.mutateAsync({ commands: [add, getCart], versioning: "follow" });
    });
    // TanStack notifies observers on a setTimeout(0) scheduler, so the render lags `act`.
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(1));
    await quiet();
    expect(gets).toBe(1);
    expect(new URL(lastUrl).searchParams.get("versioning")).toBe("follow");
  });

  it("refetches when the chain does not end with GetCart", async () => {
    answer([added]);
    const result = await mounted();
    await act(async () => {
      await result.current.chain.mutateAsync({ commands: [add] });
    });
    await waitFor(() => expect(gets).toBe(2));
  });

  it("refetches when a write follows the GetCart — that cart is already stale", async () => {
    answer([
      { index: 0, type: "GetCart", code: 200, status: "OK", data: fresh },
      { index: 1, type: "AddCartItem", code: 201, status: "Created", data: { itemId: "4", yrn: "y" } },
    ]);
    const result = await mounted();
    await act(async () => {
      await result.current.chain.mutateAsync({ commands: [getCart, add] });
    });
    await waitFor(() => expect(gets).toBe(2));
  });

  it("refetches when the GetCart was calculated for a zip code — not the cart useCart shows", async () => {
    answer([added, { index: 1, type: "GetCart", code: 200, status: "OK", data: fresh }]);
    const result = await mounted();
    await act(async () => {
      await result.current.chain.mutateAsync({
        commands: [add, { type: "GetCart", options: { zipCode: "8001", countryCode: "CH" } }],
      });
    });
    await waitFor(() => expect(gets).toBe(2));
  });

  it("rejects with the failed command's error, refetches, and keeps the stored cart id", async () => {
    answer([
      added,
      {
        index: 1, type: "UpdateCartItem", code: 404, status: "Not Found",
        data: { code: 404, status: "Not Found", message: "Cart item not found in cart cart1 with code 9" },
      },
    ]);
    const storage = createMemoryStorage();
    storage.setCartId("cart1");
    const result = await mounted(storage);
    const update: CartCommand = { type: "UpdateCartItem", data: { quantity: 1 } as CartItemUpdate, options: { itemId: "9" } };
    let error: unknown;
    await act(async () => {
      error = await result.current.chain.mutateAsync({ commands: [add, update] }).catch((e: unknown) => e);
    });
    expect(error).toBeInstanceOf(EmporixNotFoundError);
    await waitFor(() => expect(gets).toBe(2));
    // A command 404 can mean a missing item; the cart itself still exists.
    expect(storage.getCartId()).toBe("cart1");
  });

  it("resolves the cart id from storage at mutate time and names itself when there is none", async () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCartCommands(), { wrapper: wrap(storage) });
    await expect(result.current.mutateAsync({ commands: [getCart] })).rejects.toThrow(
      /^useCartCommands: no cartId available/,
    );
    answer([{ index: 0, type: "GetCart", code: 200, status: "OK", data: fresh }]);
    storage.setCartId("cart1");
    await act(async () => {
      await result.current.mutateAsync({ commands: [getCart] });
    });
    expect(new URL(lastUrl).pathname).toBe("/cart/acme/carts/cart1/execute");
  });

  it("leaves useCartMutations naming itself in the missing-id error", async () => {
    const { result } = renderHook(() => useCartMutations(), { wrapper: wrap() });
    await expect(result.current.clear.mutateAsync()).rejects.toThrow(/^useCartMutations: no cartId available/);
  });
});
