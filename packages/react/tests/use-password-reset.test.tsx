import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { usePasswordReset } from "../src/hooks/use-password-reset";
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
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  // No customer token — password reset is anonymous by definition.
  const storage = createMemoryStorage();
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("usePasswordReset", () => {
  it("request POSTs with anonymous auth", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/password/reset", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => usePasswordReset(), { wrapper: wrap() });
    await act(async () => {
      await result.current.request.mutateAsync({ email: "u@e.com" } as never);
    });
    expect(seenAuth).toBe("Bearer anon");
    await waitFor(() => expect(result.current.request.isSuccess).toBe(true));
  });

  it("confirm POSTs with anonymous auth", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post(
        "https://api.emporix.io/customer/acme/password/reset/confirm",
        ({ request }) => {
          seenAuth = request.headers.get("authorization");
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const { result } = renderHook(() => usePasswordReset(), { wrapper: wrap() });
    await act(async () => {
      await result.current.confirm.mutateAsync({
        token: "reset-tok",
        newPassword: "new",
      } as never);
    });
    expect(seenAuth).toBe("Bearer anon");
    await waitFor(() => expect(result.current.confirm.isSuccess).toBe(true));
  });

  it("works without any customer token in storage", () => {
    const { result } = renderHook(() => usePasswordReset(), { wrapper: wrap() });
    // The mere render must not throw — both request and confirm are available.
    expect(typeof result.current.request.mutateAsync).toBe("function");
    expect(typeof result.current.confirm.mutateAsync).toBe("function");
  });
});
