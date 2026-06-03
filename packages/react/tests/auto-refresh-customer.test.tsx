import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyReturns } from "../src/hooks/use-returns";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io";
let returnCalls: string[] = [];
let refreshHit = 0;
let lastRefreshToken: string | null = null;
let lastRefreshAuth: string | null = null;

const server = setupServer(
  // anonymous login (the refresh call authorizes with an anonymous token)
  http.get(`${BASE}/customerlogin/auth/anonymous/login`, () =>
    HttpResponse.json({ access_token: "anon", refresh_token: "ar", sessionId: "s", expires_in: 3599 }),
  ),
  // customer refresh endpoint
  http.get(`${BASE}/customer/acme/refreshauthtoken`, ({ request }) => {
    refreshHit += 1;
    const url = new URL(request.url);
    lastRefreshToken = url.searchParams.get("refreshToken");
    lastRefreshAuth = request.headers.get("authorization");
    return HttpResponse.json({ access_token: "NEW", refresh_token: "RT2", expires_in: 3599 });
  }),
  // B2B company context fires listMine on mount — keep it deterministic (empty).
  http.get(`${BASE}/customer-management/acme/legal-entities`, () => HttpResponse.json([])),
  // protected resource: 401 on OLD, 200 on NEW
  http.get(`${BASE}/return/acme/returns`, ({ request }) => {
    const tok = request.headers.get("authorization");
    returnCalls.push(tok ?? "");
    if (tok === "Bearer OLD") return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json([{ id: "r1" }]);
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  returnCalls = [];
  refreshHit = 0;
  lastRefreshToken = null;
  lastRefreshAuth = null;
});
afterAll(() => server.close());

function wrap(opts: { autoRefresh: boolean; onExpired?: () => void }) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const storage = createMemoryStorage({ initial: "OLD" });
  storage.setRefreshToken("RT");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={storage}
      queryClient={queryClient}
      autoRefreshCustomerToken={opts.autoRefresh}
      {...(opts.onExpired ? { onCustomerSessionExpired: opts.onExpired } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("autoRefreshCustomerToken", () => {
  it("refreshes on 401 and the retried query succeeds with the new token", async () => {
    const { result } = renderHook(() => useMyReturns(), { wrapper: wrap({ autoRefresh: true }) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(refreshHit).toBe(1);
    expect(lastRefreshToken).toBe("RT"); // stored refresh token
    expect(lastRefreshAuth).toBe("Bearer anon"); // refresh authorizes with anonymous
    expect(returnCalls).toEqual(["Bearer OLD", "Bearer NEW"]);
    expect(result.current.data).toEqual([{ id: "r1" }]);
  });

  it("calls onCustomerSessionExpired when no refresh token is stored", async () => {
    const onExpired = vi.fn();
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const storage = createMemoryStorage({ initial: "OLD" }); // no refresh token
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider
        client={client}
        storage={storage}
        queryClient={qc}
        autoRefreshCustomerToken
        onCustomerSessionExpired={onExpired}
      >
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useMyReturns(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(refreshHit).toBe(0);
  });

  it("off by default: a 401 is not auto-refreshed", async () => {
    const { result } = renderHook(() => useMyReturns(), { wrapper: wrap({ autoRefresh: false }) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(refreshHit).toBe(0);
    expect(returnCalls).toEqual(["Bearer OLD"]);
  });
});
