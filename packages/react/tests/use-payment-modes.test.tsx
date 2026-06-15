import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { usePaymentModes } from "../src/hooks/use-checkout";
import type { ReactNode } from "react";

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
  http.get("https://api.emporix.io/payment-gateway/acme/paymentmodes/frontend", () =>
    HttpResponse.json([{ id: "m1", code: "card", integrationType: "OFFSITE" }]),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

describe("usePaymentModes", () => {
  it("lists payment modes for a guest (anonymous) session", async () => {
    const { result } = renderHook(() => usePaymentModes(), {
      wrapper: wrap(createMemoryStorage()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.code).toBe("card");
  });

  it("lists payment modes for a logged-in customer", async () => {
    const { result } = renderHook(() => usePaymentModes(), {
      wrapper: wrap(createMemoryStorage({ initial: "cust" })),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.code).toBe("card");
  });
});
