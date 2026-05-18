import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LevelResolver, LEVEL } from "../src/core/logger";

const ENV = ["EMPORIX_LOG_LEVEL", "EMPORIX_LOG_LEVEL_CART", "EMPORIX_LOG_LEVEL_HTTP"];

describe("LevelResolver", () => {
  beforeEach(() => ENV.forEach((k) => delete process.env[k]));
  afterEach(() => ENV.forEach((k) => delete process.env[k]));

  it("defaults to warn with no config or env", () => {
    const r = new LevelResolver({});
    expect(r.get("cart")).toBe("warn");
    expect(r.numericLevel("cart")).toBe(LEVEL.warn);
  });

  it("config.level is the floor; per-service overrides it", () => {
    const r = new LevelResolver({ level: "info", services: { cart: "trace" } });
    expect(r.get("http")).toBe("info");
    expect(r.get("cart")).toBe("trace");
  });

  it("env per-service beats env global beats config", () => {
    process.env.EMPORIX_LOG_LEVEL = "error";
    process.env.EMPORIX_LOG_LEVEL_CART = "trace";
    const r = new LevelResolver({ level: "info", services: { cart: "debug", http: "debug" } });
    expect(r.get("cart")).toBe("trace"); // env per-service
    expect(r.get("http")).toBe("error"); // env global beats config
  });

  it("invalid env value is ignored with one warn", () => {
    process.env.EMPORIX_LOG_LEVEL_CART = "loud";
    const warns: string[] = [];
    const r = new LevelResolver({}, (m) => warns.push(m));
    expect(r.get("cart")).toBe("warn");
    expect(warns).toHaveLength(1);
  });

  it("runtime mutation propagates; env-set levels are sticky unless forced", () => {
    process.env.EMPORIX_LOG_LEVEL_CART = "trace";
    const r = new LevelResolver({ level: "warn" });
    r.set("debug");
    expect(r.get("http")).toBe("debug");
    r.set("error", "cart");
    expect(r.get("cart")).toBe("trace"); // sticky env
    r.set("error", "cart", true);
    expect(r.get("cart")).toBe("error"); // forced
  });

  it("isAtLeast compares numerically", () => {
    const r = new LevelResolver({ level: "info" });
    expect(r.isAtLeast("http", "warn")).toBe(true);
    expect(r.isAtLeast("http", "debug")).toBe(false);
  });
});
