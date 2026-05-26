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
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("EmporixProvider B2B SSR hydration", () => {
  it("initialActiveLegalEntityId wins over a stale stored value", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setActiveLegalEntityId("le-1"); // stale
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
        initialActiveLegalEntityId="le-2"
      >
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-2"));
  });
});
