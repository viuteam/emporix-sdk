import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { EmporixTelemetryEvent } from "../src/telemetry";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([
      { id: "le-1", name: "Acme", type: "COMPANY" },
      { id: "le-2", name: "Globex", type: "COMPANY" },
    ]),
  ),
  http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
    HttpResponse.json({ access_token: "t", refresh_token: "r2" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("company:switched telemetry", () => {
  it("emits a company:switched event on setActiveCompany", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r");
    const events: EmporixTelemetryEvent[] = [];

    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider
        client={client}
        storage={storage}
        queryClient={new QueryClient()}
        onTelemetry={(e) => events.push(e)}
      >
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.myCompanies).toHaveLength(2));

    await act(async () => {
      await result.current.setActiveCompany("le-2");
    });

    const switched = events.find((e) => e.type === "company:switched");
    expect(switched).toBeDefined();
    expect(switched).toMatchObject({ type: "company:switched", from: null, to: "le-2" });
  });
});
