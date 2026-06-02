import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useApprovals,
  useApproval,
  useCreateApproval,
  useUpdateApproval,
} from "../src/hooks/use-approvals";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io/approval/acme";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const storage = createMemoryStorage({ initial: "cust-tok" }); // logged-in customer
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useApprovals", () => {
  it("lists the customer's approvals with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/approvals`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "a1" }]);
      }),
    );
    const { result } = renderHook(() => useApprovals(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenAuth).toBe("Bearer cust-tok");
    expect(result.current.data).toEqual([{ id: "a1" }]);
  });
});

describe("useApproval", () => {
  it("is disabled without an id", () => {
    const { result } = renderHook(() => useApproval(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches one approval", async () => {
    server.use(http.get(`${BASE}/approvals/a1`, () => HttpResponse.json({ id: "a1" })));
    const { result } = renderHook(() => useApproval("a1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((result.current.data as { id?: string }).id).toBe("a1");
  });
});

describe("useCreateApproval", () => {
  it("creates an approval and returns { id }", async () => {
    server.use(
      http.post(`${BASE}/approvals`, () => HttpResponse.json({ id: "a1" }, { status: 201 })),
    );
    const { result } = renderHook(() => useCreateApproval(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ resource: { resourceType: "CART" } } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("a1");
  });
});

describe("useUpdateApproval", () => {
  it("patches with a JSON-Patch op-array", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/approvals/a1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useUpdateApproval(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({
        approvalId: "a1",
        ops: [{ op: "replace", path: "/status", value: "APPROVED" }] as never,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual([{ op: "replace", path: "/status", value: "APPROVED" }]);
  });
});
