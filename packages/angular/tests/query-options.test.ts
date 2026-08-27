import { describe, expect, it, vi } from "vitest";
import { auth } from "@viu/emporix-sdk";
import { emporixQueryOptions } from "../src/query-options";

const base = {
  resource: "product",
  args: ["p1"] as const,
  site: "full" as const,
  queryFn: vi.fn(async () => "value"),
};
const ctx = { tenant: "acme", token: null, siteCode: "main", language: "de" };

describe("emporixQueryOptions — read-auth mode", () => {
  it("keys as anonymous and enables when no token is stored", () => {
    const o = emporixQueryOptions({ ...base, mode: "read-auth" }, ctx);
    expect(o.queryKey).toEqual([
      "emporix",
      "product",
      "p1",
      { tenant: "acme", authKind: "anonymous", siteCode: "main", language: "de" },
    ]);
    expect(o.enabled).toBe(true);
  });

  it("keys as customer once a token is stored", () => {
    const o = emporixQueryOptions({ ...base, mode: "read-auth" }, { ...ctx, token: "t1" });
    expect(o.queryKey[3]).toMatchObject({ authKind: "customer" });
  });

  it("passes the resolved auth context to queryFn", async () => {
    const queryFn = vi.fn(async () => "v");
    const o = emporixQueryOptions({ ...base, queryFn, mode: "read-auth" }, { ...ctx, token: "t1" });
    await o.queryFn();
    expect(queryFn).toHaveBeenCalledWith(auth.customer("t1"));
  });

  it("honours an explicit auth override", () => {
    const o = emporixQueryOptions(
      { ...base, mode: "read-auth", authOverride: auth.anonymous() },
      { ...ctx, token: "t1" },
    );
    expect(o.queryKey[3]).toMatchObject({ authKind: "anonymous" });
  });
});

describe("emporixQueryOptions — customer mode", () => {
  it("stays disabled without a token, so nothing is ever fetched unauthenticated", () => {
    const o = emporixQueryOptions({ ...base, mode: "customer" }, ctx);
    expect(o.enabled).toBe(false);
    // Still keyed, and keyed as anonymous — a guest's cache entry must not
    // collide with a customer's.
    expect(o.queryKey[3]).toMatchObject({ authKind: "anonymous" });
  });

  it("enables and keys as customer with a token", () => {
    const o = emporixQueryOptions({ ...base, mode: "customer" }, { ...ctx, token: "t1" });
    expect(o.enabled).toBe(true);
    expect(o.queryKey[3]).toMatchObject({ authKind: "customer" });
  });

  it("ignores an authOverride — customer mode is token-gated by definition", () => {
    const o = emporixQueryOptions(
      { ...base, mode: "customer", authOverride: auth.anonymous() },
      { ...ctx, token: "t1" },
    );
    expect(o.queryKey[3]).toMatchObject({ authKind: "customer" });
  });
});

describe("emporixQueryOptions — gates and site fields", () => {
  it("ANDs a caller's enabled with the internal gate", () => {
    expect(emporixQueryOptions({ ...base, mode: "read-auth", enabled: false }, ctx).enabled).toBe(
      false,
    );
    expect(emporixQueryOptions({ ...base, mode: "customer", enabled: true }, ctx).enabled).toBe(
      false,
    );
  });

  it("drops site fields entirely for site: none", () => {
    const o = emporixQueryOptions({ ...base, site: "none", mode: "read-auth" }, ctx);
    expect(o.queryKey[3]).toEqual({ tenant: "acme", authKind: "anonymous" });
  });

  it("carries only language for site: language", () => {
    const o = emporixQueryOptions({ ...base, site: "language", mode: "read-auth" }, ctx);
    expect(o.queryKey[3]).toEqual({ tenant: "acme", authKind: "anonymous", language: "de" });
  });

  it("preserves a null site rather than omitting it — unbound is its own identity", () => {
    const o = emporixQueryOptions(
      { ...base, mode: "read-auth" },
      { ...ctx, siteCode: null, language: null },
    );
    expect(o.queryKey[3]).toEqual({
      tenant: "acme",
      authKind: "anonymous",
      siteCode: null,
      language: null,
    });
  });

  it("omits staleTime when not given, rather than setting it to undefined", () => {
    // exactOptionalPropertyTypes is on repo-wide; an explicit `undefined` would
    // override the ["emporix"] default of 30s with nothing.
    expect("staleTime" in emporixQueryOptions({ ...base, mode: "read-auth" }, ctx)).toBe(false);
    expect(emporixQueryOptions({ ...base, mode: "read-auth", staleTime: 5 }, ctx).staleTime).toBe(
      5,
    );
  });
});
