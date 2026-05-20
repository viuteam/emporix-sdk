import { describe, it, expect, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient, type AnonymousSessionStore } from "@viu/emporix-sdk";
import { EmporixProvider, useEmporix } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";

function mkClient() {
  return new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
}

describe("EmporixProvider", () => {
  it("useEmporix throws when no provider is present", () => {
    expect(() => renderHook(() => useEmporix())).toThrow(/EmporixProvider/);
  });

  it("exposes client + storage and renders children", () => {
    const client = mkClient();
    const storage = createMemoryStorage({ initial: "tok-1" });
    const { result } = renderHook(() => useEmporix(), {
      wrapper: ({ children }) => (
        <EmporixProvider client={client} storage={storage}>
          {children}
        </EmporixProvider>
      ),
    });
    expect(result.current.client).toBe(client);
    expect(result.current.storage.getCustomerToken()).toBe("tok-1");
    expect(client.tenant).toBe("acme");
  });

  it("renders a child tree", () => {
    render(
      <EmporixProvider client={mkClient()}>
        <span>hello</span>
      </EmporixProvider>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("memory storage notifies subscribers", () => {
    const s = createMemoryStorage();
    const seen: (string | null)[] = [];
    const unsub = s.subscribe!((t) => seen.push(t));
    s.setCustomerToken("x");
    s.setCustomerToken(null);
    unsub();
    s.setCustomerToken("y");
    expect(seen).toEqual(["x", null]);
  });

  it("wires client.tokenProvider.attachAnonymousStore with adapters into storage", () => {
    const attachSpy = vi.fn();
    const client = {
      tenant: "viu",
      tokenProvider: { attachAnonymousStore: attachSpy },
    } as unknown as EmporixClient;
    const storage = createMemoryStorage();
    storage.setAnonymousSession({ refreshToken: "rt-store", sessionId: "ss-store" });

    render(
      <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
        <div />
      </EmporixProvider>,
    );

    expect(attachSpy).toHaveBeenCalledTimes(1);
    const adapter = (attachSpy.mock.calls[0] as [AnonymousSessionStore])[0];
    expect(adapter.read()).toEqual({ refreshToken: "rt-store", sessionId: "ss-store" });

    adapter.write({ refreshToken: "rt-new", sessionId: "ss-new" });
    expect(storage.getAnonymousSession()).toEqual({ refreshToken: "rt-new", sessionId: "ss-new" });

    adapter.write(null);
    expect(storage.getAnonymousSession()).toBeNull();
  });

  it("does not throw when the client's tokenProvider has no attachAnonymousStore", () => {
    const client = { tenant: "viu", tokenProvider: {} } as unknown as EmporixClient;
    const storage = createMemoryStorage();
    expect(() =>
      render(
        <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
          <div />
        </EmporixProvider>,
      ),
    ).not.toThrow();
  });
});
