import { describe, it, expect } from "vitest";
import { validateConfig, DEFAULT_HOST } from "../src/core/config";

const creds = { backend: { clientId: "b", secret: "s" } };

describe("validateConfig", () => {
  it("accepts a minimal valid config and fills defaults", () => {
    const c = validateConfig({ tenant: "acme", credentials: creds });
    expect(c.host).toBe(DEFAULT_HOST);
    expect(c.cache.expirationBufferSeconds).toBe(60);
    expect(c.cache.maxLifetimeSeconds).toBe(3600);
    expect(c.retry.maxAttempts).toBe(3);
  });

  it.each(["AB", "ab", "1abc", "a_b", "thisnameiswaytoolongxx", "Acme"])(
    "rejects invalid tenant %s",
    (tenant) => {
      expect(() => validateConfig({ tenant, credentials: creds })).toThrow(/tenant/i);
    },
  );

  it("accepts boundary-valid tenants", () => {
    expect(validateConfig({ tenant: "abc", credentials: creds }).tenant).toBe("abc");
    expect(validateConfig({ tenant: "ab1cd2ef3gh4ij5x", credentials: creds }).tenant).toBe(
      "ab1cd2ef3gh4ij5x",
    );
  });

  it("requires credentials.backend", () => {
    // @ts-expect-error intentionally missing backend
    expect(() => validateConfig({ tenant: "acme", credentials: {} })).toThrow(/backend/i);
  });
});
