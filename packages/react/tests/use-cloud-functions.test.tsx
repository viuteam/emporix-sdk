import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useInvokeCloudFunction, useCloudFunction } from "../src/hooks/use-cloud-functions";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const FID = "fn-1";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(opts: { storage?: EmporixStorage } = {}) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const storage = opts.storage ?? createMemoryStorage();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  return { Wrapper, storage };
}

describe("useInvokeCloudFunction", () => {
  it("invokes (POST) and resolves the typed response; anonymous when no token", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cloud-functions/acme/functions/fn-1", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ greeting: "hi" });
      }),
    );
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useInvokeCloudFunction<{ greeting: string }>(), { wrapper: Wrapper });
    let res: { greeting: string } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ functionId: FID, body: { name: "x" } });
    });
    expect(res?.greeting).toBe("hi");
    expect(authHeader).toBe("Bearer anon");
  });

  it("uses the stored customer token automatically", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cloud-functions/acme/functions/fn-1", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    const storage = createMemoryStorage();
    storage.setCustomerToken("cust-9");
    const { Wrapper } = wrap({ storage });
    const { result } = renderHook(() => useInvokeCloudFunction(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ functionId: FID });
    });
    expect(authHeader).toBe("Bearer cust-9");
  });

  it("honours an explicit auth override", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cloud-functions/acme/functions/fn-1", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useInvokeCloudFunction(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ functionId: FID, auth: auth.raw("raw-tok") });
    });
    expect(authHeader).toBe("Bearer raw-tok");
  });
});

describe("useCloudFunction", () => {
  it("GETs and caches; disabled when functionId is undefined", async () => {
    let hits = 0;
    server.use(
      http.get("https://api.emporix.io/cloud-functions/acme/functions/fn-1", () => {
        hits += 1;
        return HttpResponse.json({ value: 42 });
      }),
    );
    const { Wrapper } = wrap();
    // disabled
    const disabled = renderHook(() => useCloudFunction<{ value: number }>(undefined), { wrapper: Wrapper });
    expect(disabled.result.current.fetchStatus).toBe("idle");
    // enabled
    const { result } = renderHook(() => useCloudFunction<{ value: number }>(FID), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.value).toBe(42);
    expect(hits).toBe(1);
  });
});
