import { describe, expect, it, vi, afterEach } from "vitest";
import { validateConfig } from "../src/core/config";
import type { Logger } from "../src/core/logger";

/** A user-supplied `Logger` (the shape `LoggerConfig` accepts alongside `false` and an options object). */
function spyLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const logger = {
    level: "warn",
    isLevelEnabled: () => true,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn,
    error: () => {},
    child: () => logger,
  } as unknown as Logger;
  return { logger, warn };
}

const BASE = { tenant: "viu", credentials: { storefront: { clientId: "abc" } } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateConfig: misplaced context", () => {
  it("warns when context sits at the top level", () => {
    // The field does not exist on EmporixConfig and is dropped. After that
    // `matchByContext` answers [] with no error, because the anonymous token was
    // minted without site, currency and country. Measured on tenant `viu`
    // (2026-08-18): 0 matches when misplaced, 1 when placed correctly.
    const { logger, warn } = spyLogger();
    validateConfig({ ...BASE, logger, context: { siteCode: "cosanum-b2b" } } as never);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/credentials\.storefront/);
  });

  it("stays silent when context is placed correctly", () => {
    const { logger, warn } = spyLogger();
    validateConfig({
      tenant: "viu",
      logger,
      credentials: { storefront: { clientId: "abc", context: { siteCode: "cosanum-b2b" } } },
    } as never);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to console.warn when no Logger instance is configured", () => {
    // `logger` may be absent, `false`, or a plain options object — none of those
    // carry a `warn` method, so the warning would otherwise be lost.
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateConfig({ ...BASE, context: { siteCode: "x" } } as never);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("respects logger: false and stays silent", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateConfig({ ...BASE, logger: false, context: { siteCode: "x" } } as never);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not throw — existing configs keep working", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateConfig({ ...BASE, context: { siteCode: "x" } } as never)).not.toThrow();
  });
});
