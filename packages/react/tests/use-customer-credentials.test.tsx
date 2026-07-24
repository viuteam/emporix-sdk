import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useChangeEmail,
  useConfirmEmailChange,
  useConfirmSignup,
  useResendActivation,
} from "../src/hooks/use-customer-credentials";
import type { EmporixStorage } from "../src/storage";
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

function wrap(storage: EmporixStorage = createMemoryStorage({ initial: "cust-tok" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

describe("customer credential hooks", () => {
  it("useChangeEmail POSTs the change request", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/me/accounts/internal/email/change", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(() => useChangeEmail(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ email: "a@b.co", password: "p", newEmail: "c@d.co" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("useConfirmEmailChange POSTs the token anonymously", async () => {
    server.use(
      http.post(
        "https://api.emporix.io/customer/acme/me/accounts/internal/email/change/confirm",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(() => useConfirmEmailChange(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ token: "T" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("useConfirmSignup activates and returns a session", async () => {
    server.use(
      http.get("https://api.emporix.io/customer/acme/signup/optin/Tok123", () =>
        HttpResponse.json({ access_token: "cust", refresh_token: "rt", expires_in: 100 }),
      ),
    );
    const { result } = renderHook(() => useConfirmSignup(), { wrapper: wrap() });
    let session: { customerToken?: string } | undefined;
    await act(async () => {
      session = await result.current.mutateAsync("Tok123");
    });
    expect(session?.customerToken).toBe("cust");
  });

  it("useResendActivation POSTs the email anonymously", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/signup/optin/refresh_token", () =>
        new HttpResponse(null, { status: 202 }),
      ),
    );
    const { result } = renderHook(() => useResendActivation(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ email: "a@b.co" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
