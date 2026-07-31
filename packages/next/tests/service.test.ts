import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { auth } from "@viu/emporix-sdk";
import { getEmporixServiceClient, __resetEmporixServiceClients } from "../src/service";

const CREDS = {
  productWriter: {
    clientId: "writer-id",
    secret: "writer-secret",
    scope: "product.product_create",
  },
};

/**
 * Stubs the global fetch and records every call. Token requests and API requests
 * both land here: token requests use the global fetch by design, and a service
 * client injects no fetch of its own.
 */
function stubFetch(
  tokenBody: Record<string, unknown> = { access_token: "tok", expires_in: 3600 },
): { calls: Array<{ url: string; body: string }>; tokenCalls: () => Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: typeof init?.body === "string" ? init.body : String(init?.body ?? "") });
    const payload = url.includes("/oauth/token") ? tokenBody : {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return {
    calls,
    tokenCalls: () => calls.filter((c) => c.url.includes("/oauth/token")),
  };
}

beforeEach(() => {
  __resetEmporixServiceClients();
  process.env.EMPORIX_TENANT = "viu";
  delete process.env.EMPORIX_HOST;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMPORIX_TENANT;
});

describe("getEmporixServiceClient — instance and config", () => {
  it("returns the same instance for identical options", () => {
    const a = getEmporixServiceClient({ credentials: CREDS });
    const b = getEmporixServiceClient({ credentials: CREDS });
    expect(a).toBe(b);
  });

  it("returns a different instance for different options", () => {
    const a = getEmporixServiceClient({ credentials: CREDS });
    const b = getEmporixServiceClient({ credentials: CREDS, tenant: "other" });
    expect(a).not.toBe(b);
  });

  it("never installs a fetch — a service client must not be tagged", () => {
    // Next's fetch cache does not key on Authorization. A tagged privileged GET
    // would be served to other visitors.
    const client = getEmporixServiceClient({ credentials: CREDS });
    expect(client.config.fetch).toBeUndefined();
  });

  it("passes the named credential sets through to the SDK", () => {
    const client = getEmporixServiceClient({ credentials: CREDS });
    expect(client.config.credentials.custom?.productWriter?.clientId).toBe("writer-id");
    expect(client.config.credentials.storefront).toBeUndefined();
    expect(client.config.credentials.backend).toBeUndefined();
  });

  it("uses a host override for the token request, not just the config", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS, host: "https://custom.test" });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    expect(f.tokenCalls()[0]?.url).toBe("https://custom.test/oauth/token");
  });
});

describe("getEmporixServiceClient — token behaviour", () => {
  it("sends the configured scope in the client_credentials body", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    const body = f.tokenCalls()[0]?.body ?? "";
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_id=writer-id");
    expect(body).toContain("scope=product.product_create");
  });

  it("reuses the cached token across sequential calls", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    await client.products.get("p2", undefined, auth.service("productWriter"));
    expect(f.tokenCalls()).toHaveLength(1);
  });

  it("fetches one token for ten concurrent calls", async () => {
    // Single-flight lock, core/auth.ts:235-239. Distinct from the sequential
    // case: a broken lock still passes that one.
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.products.get(`p${i}`, undefined, auth.service("productWriter")),
      ),
    );
    expect(f.tokenCalls()).toHaveLength(1);
  });

  it("re-fetches once the cached token has expired", async () => {
    // expires_in 1 minus the 60s default buffer puts expiresAt in the past, so
    // this needs no fake timers. Guards against a cache that never expires,
    // which the sequential test would also pass.
    const f = stubFetch({ access_token: "tok", expires_in: 1 });
    const client = getEmporixServiceClient({ credentials: CREDS });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    await client.products.get("p2", undefined, auth.service("productWriter"));
    expect(f.tokenCalls()).toHaveLength(2);
  });

  it("keys the token cache per credential set", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({
      credentials: {
        writer: { clientId: "writer-id", secret: "s1" },
        reader: { clientId: "reader-id", secret: "s2" },
      },
    });
    await client.products.get("p1", undefined, auth.service("writer"));
    await client.products.get("p2", undefined, auth.service("reader"));
    const bodies = f.tokenCalls().map((c) => c.body);
    expect(bodies).toHaveLength(2);
    expect(bodies.some((b) => b.includes("client_id=writer-id"))).toBe(true);
    expect(bodies.some((b) => b.includes("client_id=reader-id"))).toBe(true);
  });

  it("rejects an unknown credential set", async () => {
    stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await expect(client.products.get("p1", undefined, auth.service("nope"))).rejects.toThrow(
      /Unknown credential set "nope"/,
    );
  });
});

describe("getEmporixServiceClient — validation", () => {
  it("throws and names EMPORIX_TENANT when no tenant is resolvable", () => {
    delete process.env.EMPORIX_TENANT;
    expect(() => getEmporixServiceClient({ credentials: CREDS })).toThrow(/EMPORIX_TENANT/);
  });

  it("throws when credentials is empty", () => {
    expect(() => getEmporixServiceClient({ credentials: {} })).toThrow(
      /at least one named credential set/,
    );
  });

  it("throws and names the set when clientId or secret is empty", () => {
    // An unset env var yields "" — which reaches Emporix as a 401 that looks
    // like a permissions problem. Fail locally, once per process, instead.
    expect(() =>
      getEmporixServiceClient({ credentials: { writer: { clientId: "id", secret: "" } } }),
    ).toThrow(/"writer"/);
    expect(() =>
      getEmporixServiceClient({ credentials: { writer: { clientId: "", secret: "s" } } }),
    ).toThrow(/"writer"/);
  });
});
