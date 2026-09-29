import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useOrderTransitions } from "../src/hooks/use-order-transitions";
import { useCancelOrder } from "../src/hooks/use-cancel-order";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useOrderTransitions", () => {
  it("is disabled without an order id or without a customer token", () => {
    const noId = renderHook(() => useOrderTransitions(undefined), { wrapper: wrap() });
    const noToken = renderHook(() => useOrderTransitions("o-1"), { wrapper: wrap(createMemoryStorage()) });
    expect(noId.result.current.fetchStatus).toBe("idle");
    expect(noToken.result.current.fetchStatus).toBe("idle");
  });

  it("reads the order's transitions with the customer token, and refetches after a cancel", async () => {
    const auths: (string | null)[] = [];
    let allowed = [{ status: "DECLINED" }];
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", ({ request }) => {
        auths.push(request.headers.get("authorization"));
        return HttpResponse.json(allowed);
      }),
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", () => {
        allowed = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(
      () => ({ transitions: useOrderTransitions("o-1"), cancel: useCancelOrder() }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.transitions.data).toEqual([{ status: "DECLINED" }]));
    expect(auths).toEqual(["Bearer cust"]);

    await act(() => result.current.cancel.mutateAsync("o-1"));
    await waitFor(() => expect(result.current.transitions.data).toEqual([]));
    expect(auths).toEqual(["Bearer cust", "Bearer cust"]);
  });
});
