import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { auth } from "@viu/emporix-sdk";
import { getEmporixClient, createTaggingFetch, __resetEmporixClients } from "../src/client";

/** `next` is not part of the standard RequestInit. */
interface NextRequestInit extends RequestInit {
  next?: { tags?: string[]; revalidate?: number };
}
const nextOf = (init: RequestInit | undefined): NextRequestInit["next"] =>
  (init as NextRequestInit | undefined)?.next;

/**
 * Captures what the tagging fetch hands the global fetch. Answers the anonymous
 * login with a real token payload so the SDK's bootstrap succeeds, and `{}` for
 * everything else.
 */
function captureGlobalFetch() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const body = url.includes("/customerlogin/")
      ? {
          access_token: "anon",
          token_type: "Bearer",
          expires_in: 3599,
          refresh_token: "rt",
          sessionId: "s",
        }
      : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { calls };
}

beforeEach(() => {
  __resetEmporixClients();
  process.env.EMPORIX_TENANT = "acme";
  process.env.EMPORIX_STOREFRONT_CLIENT_ID = "sf";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EMPORIX_TENANT;
  delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
});

describe("createTaggingFetch", () => {
  it("attaches tags and revalidate to a taggable GET", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1", { method: "GET" });

    expect(nextOf(calls[0]!.init)).toEqual({
      tags: ["emporix:product:p1", "emporix:products"],
      revalidate: 60,
    });
  });

  it("leaves a non-GET untagged", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1", { method: "POST" });

    expect(nextOf(calls[0]!.init)).toBeUndefined();
  });

  it("treats a missing method as GET, matching the fetch default", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1");

    expect(nextOf(calls[0]!.init)?.tags).toEqual(["emporix:product:p1", "emporix:products"]);
  });

  it("leaves an untaggable URL untouched", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/cart/acme/carts/c1", { method: "GET" });

    expect(nextOf(calls[0]!.init)).toBeUndefined();
  });

  it("preserves the caller's other init fields", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1", {
      method: "GET",
      headers: { "x-test": "1" },
    });

    expect((calls[0]!.init?.headers as Record<string, string>)["x-test"]).toBe("1");
  });

  it("accepts a URL object, which is what the SDK passes", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f(new URL("https://api.emporix.io/product/acme/products/p1"), { method: "GET" });

    expect(nextOf(calls[0]!.init)?.tags).toContain("emporix:product:p1");
  });
});

describe("getEmporixClient", () => {
  it("memoizes per tenant+tagged+revalidate", () => {
    const a = getEmporixClient();
    expect(getEmporixClient()).toBe(a);

    expect(getEmporixClient({ tagged: false })).not.toBe(a);
    expect(getEmporixClient({ revalidate: 60 })).not.toBe(a);
    expect(getEmporixClient({ tenant: "other" })).not.toBe(a);

    // ...but the same options return the same instance again.
    expect(getEmporixClient({ tagged: false })).toBe(getEmporixClient({ tagged: false }));
  });

  it("keys on host too, so a different host is a different client", () => {
    const a = getEmporixClient();
    expect(getEmporixClient({ host: "https://staging.emporix.io" })).not.toBe(a);
  });

  it("throws a helpful error when the tenant is unset", () => {
    delete process.env.EMPORIX_TENANT;
    expect(() => getEmporixClient()).toThrow(/EMPORIX_TENANT/);
  });

  it("throws a helpful error when the client id is unset", () => {
    delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
    expect(() => getEmporixClient()).toThrow(/EMPORIX_STOREFRONT_CLIENT_ID/);
  });

  it("the default client tags a catalog GET end to end", async () => {
    const { calls } = captureGlobalFetch();
    const sdk = getEmporixClient();

    await sdk.products.get("p1", undefined, auth.anonymous());

    const product = calls.find((c) => c.url.includes("/product/acme/products/p1"));
    expect(product).toBeDefined();
    expect(nextOf(product!.init)?.tags).toEqual(["emporix:product:p1", "emporix:products"]);
    expect(nextOf(product!.init)?.revalidate).toBe(3600);
  });

  it("keys on context, so two contexts are two clients", () => {
    const a = getEmporixClient({ context: { siteCode: "main" } });
    const b = getEmporixClient({ context: { siteCode: "other" } });
    expect(a).not.toBe(b);
    // Same context returns the same instance.
    expect(getEmporixClient({ context: { siteCode: "main" } })).toBe(a);
    // No context is distinct from any context.
    expect(getEmporixClient()).not.toBe(a);
  });

  it("binds the context onto the storefront credentials", () => {
    const sdk = getEmporixClient({ context: { siteCode: "main", currency: "CHF" } });
    expect(sdk.config.credentials.storefront?.context).toEqual({
      siteCode: "main",
      currency: "CHF",
    });
  });

  it("the untagged client tags nothing — the customer-token boundary", async () => {
    const { calls } = captureGlobalFetch();
    const sdk = getEmporixClient({ tagged: false });

    await sdk.products.get("p1", undefined, auth.customer("cust"));

    const product = calls.find((c) => c.url.includes("/product/acme/products/p1"));
    expect(product).toBeDefined();
    expect(nextOf(product!.init)).toBeUndefined();
  });

  it("never tags the token request, even on the tagged client", async () => {
    const { calls } = captureGlobalFetch();
    const sdk = getEmporixClient();

    await sdk.products.get("p1", undefined, auth.anonymous());

    const token = calls.find((c) => c.url.includes("/customerlogin/"));
    expect(token).toBeDefined();
    expect(nextOf(token!.init)).toBeUndefined();
  });
});
