import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useAddSessionAttribute,
  useRemoveSessionAttribute,
} from "../src/hooks/use-session-context";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
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

describe("session-context attribute hooks", () => {
  it("useAddSessionAttribute POSTs the attribute", async () => {
    let body: unknown;
    server.use(
      http.post("https://api.emporix.io/session-context/acme/me/context/attributes", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );
    const { result } = renderHook(() => useAddSessionAttribute(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ key: "k", value: "v" } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ key: "k", value: "v" });
  });

  it("useRemoveSessionAttribute DELETEs a named attribute", async () => {
    server.use(
      http.delete("https://api.emporix.io/session-context/acme/me/context/attributes/color", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(() => useRemoveSessionAttribute(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync("color");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
