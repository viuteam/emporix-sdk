import { describe, it, expect } from "vitest";
import { LevelResolver, createConsoleLogger, createNoopLogger, redact } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";

describe("redact", () => {
  it("redacts default keys case-insensitively, deep, in arrays", () => {
    const out = redact({
      Authorization: "Bearer abc",
      nested: { password: "p", items: [{ access_token: "T" }] },
      keep: 1,
    });
    expect(out).toEqual({
      Authorization: "Bearer ***redacted***",
      nested: { password: "***redacted***", items: [{ access_token: "***redacted***" }] },
      keep: 1,
    });
  });

  it("strips token from an AuthContext, keeping kind", () => {
    expect(redact({ kind: "customer", token: "SECRET" })).toEqual({ kind: "customer" });
  });

  it("honours extra redact keys but never drops the default floor", () => {
    const out = redact({ customField: "x", token: "y" }, ["customField"]);
    expect(out).toEqual({ customField: "***redacted***", token: "***redacted***" });
  });
});

describe("loggers", () => {
  it("noop logger never emits and reports silent", () => {
    const l = createNoopLogger();
    expect(l.level).toBe("silent");
    expect(l.isLevelEnabled("error")).toBe(false);
    l.error("boom"); // no throw
  });

  it("console logger respects resolver level and child bindings", () => {
    const r = new LevelResolver({ level: "warn" });
    const mem = new MemoryLogger(r, { service: "cart" });
    const child = mem.child({ requestId: "r1" });
    child.debug("hidden");
    child.warn("shown", { token: "SECRET" });
    expect(mem.entries.map((e) => e.msg)).toEqual(["shown"]);
    expect(mem.entries[0]?.fields).toEqual({
      service: "cart",
      requestId: "r1",
      token: "***redacted***",
    });
    expect(mem.entries[0]?.service).toBe("cart");
  });

  it("createConsoleLogger emits via console without leaking secrets", () => {
    const r = new LevelResolver({ level: "info" });
    const lines: unknown[][] = [];
    const spy = (...a: unknown[]) => lines.push(a);
    const l = createConsoleLogger(
      r,
      { service: "auth" },
      { sink: { info: spy, warn: spy, error: spy, log: spy } },
    );
    l.info("authenticated", { access_token: "SECRET" });
    expect(JSON.stringify(lines)).not.toContain("SECRET");
  });
});
