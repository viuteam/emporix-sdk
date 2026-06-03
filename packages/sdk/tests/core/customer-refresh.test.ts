import { describe, it, expect } from "vitest";
import { CustomerRefreshRegistry } from "../../src/core/auth";

describe("CustomerRefreshRegistry", () => {
  it("is disabled and returns null with no refresher", async () => {
    const reg = new CustomerRefreshRegistry();
    expect(reg.enabled).toBe(false);
    expect(await reg.refresh("old")).toBeNull();
  });

  it("single-flights concurrent refreshes (refresh_token rotates)", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    let release!: (v: string) => void;
    reg.set({
      refresh: () => {
        calls += 1;
        return new Promise<string>((r) => {
          release = r;
        });
      },
    });
    const a = reg.refresh("old");
    const b = reg.refresh("old");
    release("new");
    expect(await a).toBe("new");
    expect(await b).toBe("new");
    expect(calls).toBe(1);
  });

  it("allows a new refresh after the inflight settles", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    reg.set({
      refresh: async () => {
        calls += 1;
        return "t" + calls;
      },
    });
    expect(await reg.refresh("old")).toBe("t1");
    expect(await reg.refresh("old")).toBe("t2");
    expect(calls).toBe(2);
  });

  it("set(null) disables again", async () => {
    const reg = new CustomerRefreshRegistry();
    reg.set({ refresh: async () => "x" });
    reg.set(null);
    expect(reg.enabled).toBe(false);
    expect(await reg.refresh("old")).toBeNull();
  });
});
