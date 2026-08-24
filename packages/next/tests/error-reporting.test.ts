import { describe, it, expect, vi, afterEach } from "vitest";
import {
  setEmporixErrorReporter,
  reportEmporixError,
  __resetEmporixErrorReporter,
  type EmporixErrorEvent,
} from "../src/error-reporting";

afterEach(() => __resetEmporixErrorReporter());

describe("the error-reporting seam", () => {
  it("is a no-op with no reporter registered", () => {
    expect(() =>
      reportEmporixError({ code: "session.flush_failed", degradedTo: "x", cause: new Error("e") }),
    ).not.toThrow();
  });

  it("hands the registered reporter a complete event", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    const cause = new Error("redis down");
    reportEmporixError({
      code: "session.store.read_failed",
      degradedTo: "request continues as a logged-out visitor",
      cause,
      context: { site: "token-proxy" },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe("session.store.read_failed");
    expect(seen[0]?.degradedTo).toBe("request continues as a logged-out visitor");
    expect(seen[0]?.cause).toBe(cause);
    expect(seen[0]?.context).toEqual({ site: "token-proxy" });
  });

  it("defaults severity to error and takes warning when asked", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    reportEmporixError({ code: "session.flush_failed", degradedTo: "x", cause: null });
    reportEmporixError({
      code: "session.logout_upstream_failed",
      degradedTo: "y",
      cause: null,
      severity: "warning",
    });
    expect(seen.map((e) => e.severity)).toEqual(["error", "warning"]);
  });

  it("redacts the context before the reporter sees it", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    reportEmporixError({
      code: "session.store.read_failed",
      degradedTo: "x",
      cause: null,
      context: { authorization: "Bearer super-secret", site: "proxy" },
    });
    expect(JSON.stringify(seen[0]?.context)).not.toContain("super-secret");
    expect(seen[0]?.context.site).toBe("proxy");
  });

  it("contains a throwing reporter — the caller must not learn about it", () => {
    setEmporixErrorReporter(() => {
      throw new Error("the tool is down");
    });
    expect(() =>
      reportEmporixError({ code: "webhook.handler_failed", degradedTo: "x", cause: null }),
    ).not.toThrow();
  });

  it("unregisters on null", () => {
    const fn = vi.fn();
    setEmporixErrorReporter(fn);
    setEmporixErrorReporter(null);
    reportEmporixError({ code: "session.flush_failed", degradedTo: "x", cause: null });
    expect(fn).not.toHaveBeenCalled();
  });
});
