import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCustomerToken, useCartId } from "../src/hooks/internal/use-storage-snapshot";
import type { ReactNode } from "react";

function wrap(storage = createMemoryStorage()) {
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

describe("useCustomerToken / useCartId", () => {
  it("re-renders on an external storage token write (login from anywhere)", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerToken(), { wrapper: wrap(storage) });
    expect(result.current).toBeNull();
    act(() => storage.setCustomerToken("cust"));
    expect(result.current).toBe("cust");
    act(() => storage.setCustomerToken(null));
    expect(result.current).toBeNull();
  });

  it("re-renders on cartId writes and ignores other keys", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCartId(), { wrapper: wrap(storage) });
    expect(result.current).toBeNull();
    act(() => storage.setCartId("c-1"));
    expect(result.current).toBe("c-1");
    act(() => storage.setSiteCode("main")); // unrelated key — value must stay stable
    expect(result.current).toBe("c-1");
  });

  it("two consumers always observe the same token (no tearing across the tree)", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(
      () => ({ a: useCustomerToken(), b: useCustomerToken() }),
      { wrapper: wrap(storage) },
    );
    act(() => storage.setCustomerToken("t-1"));
    expect(result.current.a).toBe("t-1");
    expect(result.current.b).toBe("t-1");
  });
});
