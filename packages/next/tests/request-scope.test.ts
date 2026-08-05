import { describe, expect, it } from "vitest";
import { requestScoped } from "../src/request-scope";

describe("requestScoped", () => {
  it("builds once per anchor and key", async () => {
    const anchor = {};
    let builds = 0;
    const build = async (): Promise<{ n: number }> => {
      builds += 1;
      return { n: builds };
    };
    const a = await requestScoped(anchor, "k", build);
    const b = await requestScoped(anchor, "k", build);
    expect(a).toBe(b);
    expect(builds).toBe(1);
  });

  it("keeps different keys apart", async () => {
    const anchor = {};
    const a = await requestScoped(anchor, "read", async () => ({ mode: "read" }));
    const b = await requestScoped(anchor, "write", async () => ({ mode: "write" }));
    expect(a).not.toBe(b);
  });

  it("keeps different anchors apart — one request must not see another's", async () => {
    // The whole safety argument: the anchor is per request, so two requests
    // cannot share a session even under the same key.
    const first = await requestScoped({}, "k", async () => ({ id: 1 }));
    const second = await requestScoped({}, "k", async () => ({ id: 2 }));
    expect(first).toEqual({ id: 1 });
    expect(second).toEqual({ id: 2 });
  });

  it("shares one in-flight build between concurrent callers", async () => {
    // Storing the promise rather than the result is what makes this true — a
    // page with two parallel reads would otherwise build twice.
    const anchor = {};
    let builds = 0;
    const build = async (): Promise<{ builds: number }> => {
      builds += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { builds };
    };
    const [a, b] = await Promise.all([
      requestScoped(anchor, "k", build),
      requestScoped(anchor, "k", build),
    ]);
    expect(a).toBe(b);
    expect(builds).toBe(1);
  });

  it("does not cache a rejected build", async () => {
    // A store blip must not poison every later read in the same request: one
    // failed Redis call would otherwise take the whole page down with it.
    const anchor = {};
    let calls = 0;
    const build = async (): Promise<{ ok: boolean }> => {
      calls += 1;
      if (calls === 1) throw new Error("store down");
      return { ok: true };
    };
    await expect(requestScoped(anchor, "k", build)).rejects.toThrow("store down");
    await expect(requestScoped(anchor, "k", build)).resolves.toEqual({ ok: true });
  });
});
