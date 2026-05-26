import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyOrders } from "../src/hooks/use-my-orders";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([
      { id: "le-1", name: "Acme", type: "COMPANY" },
      { id: "le-2", name: "Globex", type: "COMPANY" },
    ]),
  ),
  http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
    HttpResponse.json({ access_token: "scoped", refresh_token: "r2" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useMyOrders B2B switch", () => {
  it("re-fetches when the active company changes", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r");
    const calls: Array<string | null> = [];
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        calls.push(new URL(request.url).searchParams.get("legalEntityId"));
        return HttpResponse.json({ items: [], pageNumber: 1, pageSize: 10, hasNextPage: false });
      }),
    );
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
    const { result } = renderHook(
      () => ({ orders: useMyOrders(), company: useActiveCompany() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.company.myCompanies).toHaveLength(2));
    await act(async () => {
      await result.current.company.setActiveCompany("le-1");
    });
    await waitFor(() => expect(calls).toContain("le-1"));
    await act(async () => {
      await result.current.company.setActiveCompany("le-2");
    });
    await waitFor(() => expect(calls).toContain("le-2"));
  });
});
