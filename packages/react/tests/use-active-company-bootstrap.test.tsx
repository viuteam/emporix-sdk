import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useActiveCompany bootstrap", () => {
  it("mode='b2c' when the customer has zero legal entities", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([]),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.mode).toBe("b2c");
    expect(result.current.activeCompany).toBeNull();
    expect(result.current.myCompanies).toEqual([]);
  });

  it("auto-picks the only company when there is exactly one", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r-tok");
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
        HttpResponse.json({
          access_token: "anon", token_type: "Bearer", expires_in: 3599,
          refresh_token: "anon-rt", sessionId: "s",
        }),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped-tok", refresh_token: "r2" }),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-1"));
    expect(result.current.mode).toBe("b2b");
    expect(storage.getActiveLegalEntityId()).toBe("le-1");
  });

  it("stays 'unresolved' when the customer has multiple companies and no persisted pick", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([
          { id: "le-1", name: "Acme", type: "COMPANY" },
          { id: "le-2", name: "Globex", type: "COMPANY" },
        ]),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.myCompanies).toHaveLength(2));
    expect(result.current.mode).toBe("unresolved");
    expect(result.current.activeCompany).toBeNull();
  });

  it("honours a persisted activeLegalEntityId when it matches a company", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-2");
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([
          { id: "le-1", name: "Acme", type: "COMPANY" },
          { id: "le-2", name: "Globex", type: "COMPANY" },
        ]),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-2"));
    expect(result.current.mode).toBe("b2b");
  });

  it("drops a stale persisted activeLegalEntityId that doesn't match any company", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-gone");
    storage.setRefreshToken("r-tok");
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
        HttpResponse.json({
          access_token: "anon", token_type: "Bearer", expires_in: 3599,
          refresh_token: "anon-rt", sessionId: "s",
        }),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped-tok", refresh_token: "r2" }),
      ),
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-1"));
    expect(storage.getActiveLegalEntityId()).toBe("le-1");
  });
});
