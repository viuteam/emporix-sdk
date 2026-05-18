import { describe, it, expect } from "vitest";
import { auth, resolveToken, type TokenProvider } from "../src/core/auth";

const fakeProvider: TokenProvider = {
  getToken: async (set) => `svc:${set}`,
  getAnonymousToken: async () => ({
    accessToken: "anon", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
};

describe("auth helper", () => {
  it("builds each AuthContext kind", () => {
    expect(auth.service()).toEqual({ kind: "service" });
    expect(auth.service("partner")).toEqual({ kind: "service", credentials: "partner" });
    expect(auth.anonymous()).toEqual({ kind: "anonymous" });
    expect(auth.customer("c")).toEqual({ kind: "customer", token: "c" });
    expect(auth.raw("x")).toEqual({ kind: "raw", token: "x" });
  });
});

describe("resolveToken", () => {
  it("service resolves via provider with default 'backend'", async () => {
    expect(await resolveToken({ kind: "service" }, fakeProvider)).toBe("svc:backend");
    expect(await resolveToken({ kind: "service", credentials: "partner" }, fakeProvider)).toBe(
      "svc:partner",
    );
  });
  it("anonymous resolves via provider's anonymous token", async () => {
    expect(await resolveToken({ kind: "anonymous" }, fakeProvider)).toBe("anon");
  });
  it("customer and raw pass through verbatim", async () => {
    expect(await resolveToken({ kind: "customer", token: "C" }, fakeProvider)).toBe("C");
    expect(await resolveToken({ kind: "raw", token: "R" }, fakeProvider)).toBe("R");
  });
});
