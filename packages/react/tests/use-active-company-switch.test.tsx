import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useActiveCompany switch", () => {
  it("setActiveCompany('le-2') refreshes the token, drops the cart id, and updates state", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setCartId("old-cart");
    storage.setRefreshToken("r-tok");

    let refreshLegalEntityId: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([
          { id: "le-1", name: "Acme", type: "COMPANY" },
          { id: "le-2", name: "Globex", type: "COMPANY" },
        ]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        refreshLegalEntityId = new URL(request.url).searchParams.get("legalEntityId");
        return HttpResponse.json({ access_token: "scoped-le-2", refresh_token: "r2" });
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
    const { result } = renderHook(() => useActiveCompany(), { wrapper });

    await waitFor(() => expect(result.current.myCompanies).toHaveLength(2));
    expect(result.current.mode).toBe("unresolved");

    await act(async () => {
      await result.current.setActiveCompany("le-2");
    });

    expect(refreshLegalEntityId).toBe("le-2");
    expect(storage.getCustomerToken()).toBe("scoped-le-2");
    expect(storage.getCartId()).toBeNull();
    expect(storage.getActiveLegalEntityId()).toBe("le-2");
    expect(result.current.activeCompany?.id).toBe("le-2");
    expect(result.current.mode).toBe("b2b");
  });

  it("setActiveCompany(null) returns to B2C mode (refresh without legalEntityId)", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-1");
    storage.setRefreshToken("r-tok");

    let refreshHadLE = true;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        refreshHadLE = new URL(request.url).searchParams.has("legalEntityId");
        return HttpResponse.json({ access_token: "b2c-tok", refresh_token: "r2" });
      }),
    );

    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-1"));

    await act(async () => {
      await result.current.setActiveCompany(null);
    });

    // The bootstrap path (single-company auto-pick) called refresh once with le-1,
    // then setActiveCompany(null) called it again without legalEntityId.
    expect(refreshHadLE).toBe(false);
    expect(result.current.activeCompany).toBeNull();
    expect(result.current.mode).toBe("b2c");
    expect(storage.getActiveLegalEntityId()).toBeNull();
  });
});
