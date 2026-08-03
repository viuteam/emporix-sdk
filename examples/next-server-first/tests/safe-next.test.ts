import { describe, expect, it } from "vitest";
import { safeNext } from "../app/lib/safe-next";

/**
 * The only trust boundary in this demo, and the only thing here with unit tests —
 * the other examples have none and say so. An open redirect is not a demo detail:
 * `/login?next=https://evil.com` would hand a visitor who just typed their
 * password to somebody else's site.
 */
describe("safeNext", () => {
  it("keeps a plain path", () => {
    expect(safeNext("/account/orders")).toBe("/account/orders");
  });

  it("rejects a protocol-relative absolute link", () => {
    // `//evil.com` starts with a slash and is NOT a path — the browser reads it
    // as an absolute URL on the current scheme. This is the case a naive
    // `startsWith("/")` check waves through.
    expect(safeNext("//evil.com")).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe("/");
  });

  it("falls back when absent", () => {
    expect(safeNext(undefined)).toBe("/");
  });
});
