import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the vendored spec list", () => {
  // `fetch-specs.ts` runs the sync at module level. A test that imported the
  // list from there re-downloaded every spec into packages/sdk/specs/ while
  // the suite ran, and failed outright where there is no network (the API sync
  // skill's sandbox). The list lives in a module of its own for that reason.
  it("can be imported without fetching anything", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { SPECS } = await import("../scripts/specs");

    expect(Object.keys(SPECS).length).toBeGreaterThan(40);
    expect(SPECS.product).toMatch(/^https:\/\/raw\.githubusercontent\.com\/emporix\/api-references\//);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
