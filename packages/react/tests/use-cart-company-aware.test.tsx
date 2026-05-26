import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCart } from "../src/hooks/use-cart";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
  ),
  http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
    HttpResponse.json({ access_token: "scoped", refresh_token: "r2" }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart-le-1", () =>
    HttpResponse.json({ id: "cart-le-1", siteCode: "main" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useCart is company-aware via query key", () => {
  it("query key tuple includes legalEntityId once active", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setCartId("cart-le-1");
    storage.setRefreshToken("r-tok");
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    );
    // Pass cartId explicitly — the auto-pick path drops storage.cartId on switch.
    const { result } = renderHook(
      () => ({ cart: useCart("cart-le-1"), company: useActiveCompany() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.company.activeCompany?.id).toBe("le-1"));
    await waitFor(() => expect(result.current.cart.isSuccess).toBe(true));
    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    const cartKey = keys.find((k) => Array.isArray(k) && k[1] === "cart");
    expect(JSON.stringify(cartKey)).toContain("le-1");
  });
});
