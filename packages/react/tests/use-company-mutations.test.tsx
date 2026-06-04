import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useCreateCompany,
  useUpdateCompany,
  useDeleteCompany,
  useAssignContact,
  useUpdateContactAssignment,
  useUnassignContact,
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
} from "../src/hooks/use-company-mutations";
import { useMyCompanies } from "../src/hooks/use-my-companies";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
  // Default — CompanyContextProvider auto-fetches listMine on mount in every test.
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const storage = createMemoryStorage({ initial: "cust" });
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  return { Wrapper, queryClient };
}

describe("company mutation hooks", () => {
  it("useCreateCompany POSTs and invalidates useMyCompanies", async () => {
    const { Wrapper } = wrap();
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => {
        calls += 1;
        return HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]);
      }),
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json({ id: "le-new" }, { status: 201 }),
      ),
    );
    const { result } = renderHook(
      () => ({ list: useMyCompanies(), create: useCreateCompany() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    // CompanyContextProvider's bootstrap also fetches listMine, so total is ≥1.
    const before = calls;
    await act(async () => {
      await result.current.create.mutateAsync({ name: "New Co" });
    });
    // Mutation invalidates ["emporix","companies","mine"] → useMyCompanies refetches.
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("useUpdateCompany PATCHes", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        HttpResponse.json({ id: "le-1", name: "Patched", type: "COMPANY" }),
      ),
    );
    const { result } = renderHook(() => useUpdateCompany(), { wrapper: Wrapper });
    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({ id: "le-1", patch: { name: "Patched" } });
    });
    expect((returned as { name?: string }).name).toBe("Patched");
  });

  it("useDeleteCompany DELETEs", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(() => useDeleteCompany(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync("le-1");
    });
    expect(result.current.isSuccess).toBe(true);
  });

  it("useAssignContact POSTs and useUnassignContact DELETEs", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/contact-assignments", () =>
        HttpResponse.json({ id: "ca-new" }, { status: 201 }),
      ),
      http.delete("https://api.emporix.io/customer-management/acme/contact-assignments/ca-new", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(
      () => ({ a: useAssignContact(), u: useUnassignContact() }),
      { wrapper: Wrapper },
    );
    let assignReturned: unknown;
    await act(async () => {
      assignReturned = await result.current.a.mutateAsync({
        legalEntity: { id: "le-1" },
        customer: { id: "cu-1" },
        type: "CONTACT",
      });
    });
    expect((assignReturned as { id?: string }).id).toBe("ca-new");
    await act(async () => {
      await result.current.u.mutateAsync("ca-new");
    });
    await waitFor(() => expect(result.current.u.isSuccess).toBe(true));
  });

  it("useUpdateContactAssignment PATCHes", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/contact-assignments/ca-1", () =>
        HttpResponse.json({ id: "ca-1", type: "LOGISTICS" }),
      ),
    );
    const { result } = renderHook(() => useUpdateContactAssignment(), { wrapper: Wrapper });
    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({ id: "ca-1", patch: { type: "LOGISTICS" } });
    });
    expect((returned as { type?: string }).type).toBe("LOGISTICS");
  });

  it("useCreateLocation / useUpdateLocation / useDeleteLocation roundtrip", async () => {
    const { Wrapper } = wrap();
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/locations", () =>
        HttpResponse.json({ id: "loc-new" }, { status: 201 }),
      ),
      http.patch("https://api.emporix.io/customer-management/acme/locations/loc-new", () =>
        HttpResponse.json({ id: "loc-new", name: "Renamed", type: "HEADQUARTER" }),
      ),
      http.delete("https://api.emporix.io/customer-management/acme/locations/loc-new", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(
      () => ({
        c: useCreateLocation(),
        u: useUpdateLocation(),
        d: useDeleteLocation(),
      }),
      { wrapper: Wrapper },
    );
    let createReturned: unknown;
    await act(async () => {
      createReturned = await result.current.c.mutateAsync({
        name: "HQ",
        type: "HEADQUARTER",
        contactDetails: { city: "Zürich" },
      });
    });
    expect((createReturned as { id?: string }).id).toBe("loc-new");
    let updateReturned: unknown;
    await act(async () => {
      updateReturned = await result.current.u.mutateAsync({ id: "loc-new", patch: { name: "Renamed" } });
    });
    expect((updateReturned as { name?: string }).name).toBe("Renamed");
    await act(async () => {
      await result.current.d.mutateAsync("loc-new");
    });
    await waitFor(() => expect(result.current.d.isSuccess).toBe(true));
  });
});
