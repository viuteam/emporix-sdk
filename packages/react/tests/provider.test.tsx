import { describe, it, expect } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { EmporixClient } from "@viu/emporix-sdk";
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
});
