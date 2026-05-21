import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useUpdateCustomer,
  useChangePassword,
} from "../src/hooks/use-customer-profile";
import type { EmporixStorage } from "../src/storage";
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

function wrap(
  storage: EmporixStorage = createMemoryStorage({ initial: "cust-tok" }),
  queryClient?: QueryClient,
) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const qc =
    queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

describe("useUpdateCustomer", () => {
  it("PUTs the patch and returns the updated Customer", async () => {
    let seenBody: { firstName?: string } | undefined;
    server.use(
      http.put("https://api.emporix.io/customer/acme/me", async ({ request }) => {
        seenBody = (await request.json()) as { firstName?: string };
        return HttpResponse.json({ id: "c1", contactEmail: "a@b.co", firstName: "New" });
      }),
    );
    const { result } = renderHook(() => useUpdateCustomer(), { wrapper: wrap() });
    let returned: { firstName?: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ firstName: "New" });
    });
    expect(seenBody?.firstName).toBe("New");
    expect(returned?.firstName).toBe("New");
  });

  it("invalidates the customer.me query on success", async () => {
    server.use(
      http.put("https://api.emporix.io/customer/acme/me", () =>
        HttpResponse.json({ id: "c1", firstName: "Updated" }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["emporix", "customer", "me", { tenant: "acme", hasToken: true }];
    qc.setQueryData(key, { id: "c1", firstName: "Old" });
    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: wrap(createMemoryStorage({ initial: "cust" }), qc),
    });
    await act(async () => {
      await result.current.mutateAsync({ firstName: "Updated" });
    });
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("throws when no customer token is stored", () => {
    const storage = createMemoryStorage();
    expect(() => renderHook(() => useUpdateCustomer(), { wrapper: wrap(storage) })).toThrow(
      /logged-in customer/,
    );
  });
});

describe("useChangePassword", () => {
  it("PUTs the input and resolves to void", async () => {
    let seenBody: { currentPassword?: string; newPassword?: string } | undefined;
    server.use(
      http.put(
        "https://api.emporix.io/customer/acme/password",
        async ({ request }) => {
          seenBody = (await request.json()) as {
            currentPassword?: string;
            newPassword?: string;
          };
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const { result } = renderHook(() => useChangePassword(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ currentPassword: "old", newPassword: "new" });
    });
    expect(seenBody?.currentPassword).toBe("old");
    expect(seenBody?.newPassword).toBe("new");
    expect(result.current.isSuccess).toBe(true);
  });

  it("throws when no customer token is stored", () => {
    const storage = createMemoryStorage();
    expect(() => renderHook(() => useChangePassword(), { wrapper: wrap(storage) })).toThrow(
      /logged-in customer/,
    );
  });
});
