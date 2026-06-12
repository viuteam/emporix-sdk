import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import { StrictMode, type ReactNode } from "react";

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

  it("bootstrap auto-switch refreshes the token exactly once under StrictMode", async () => {
    let refreshHits = 0;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-solo", name: "Solo GmbH", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
        HttpResponse.json({
          access_token: "anon", token_type: "Bearer", expires_in: 3599,
          refresh_token: "anon-rt", sessionId: "s",
        }),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () => {
        refreshHits += 1;
        return HttpResponse.json({
          access_token: `cust-${refreshHits}`,
          refresh_token: `rt-${refreshHits}`,
        });
      }),
    );
    const storage = createMemoryStorage({ initial: "cust-0" });
    storage.setRefreshToken("rt-0");
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <EmporixProvider
          client={client}
          storage={storage}
          queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {children}
        </EmporixProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-solo"));
    // StrictMode double-mounts: without cancellation BOTH loads auto-switch and
    // BOTH consume the same refresh token — server-side rotation would 401.
    expect(refreshHits).toBe(1);
  });

  it("serializes concurrent company switches against server-side refresh rotation", async () => {
    let rt = "rt-0";
    let issued = 0;
    let stale401 = 0;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([
          { id: "le-1", name: "Acme", type: "COMPANY" },
          { id: "le-2", name: "Globex", type: "COMPANY" },
        ]),
      ),
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
        HttpResponse.json({
          access_token: "anon", token_type: "Bearer", expires_in: 3599,
          refresh_token: "anon-rt", sessionId: "s",
        }),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        const presented = new URL(request.url).searchParams.get("refreshToken");
        if (presented !== rt) {
          stale401 += 1; // a stale token reached the server — switches overlapped
          return HttpResponse.json({ error: "stale_refresh" }, { status: 401 });
        }
        issued += 1;
        rt = `rt-${issued}`;
        return HttpResponse.json({ access_token: `cust-${issued}`, refresh_token: rt });
      }),
    );
    // Two companies, no persisted pick → bootstrap stays "unresolved" (no auto
    // switch, no refresh) so the only refreshes are the two we fire below.
    const storage = createMemoryStorage({ initial: "cust-0" });
    storage.setRefreshToken("rt-0");
    const { result } = renderHook(() => useActiveCompany(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.mode).toBe("unresolved"));

    await act(async () => {
      await Promise.allSettled([
        result.current.setActiveCompany("le-1"),
        result.current.setActiveCompany("le-2"),
      ]);
    });

    // Serialized: the second switch reads the rotated token, so no stale token
    // ever reaches the server. Unserialized, both read rt-0 → one 401s.
    expect(stale401).toBe(0);
    expect(issued).toBe(2);
  });
});
