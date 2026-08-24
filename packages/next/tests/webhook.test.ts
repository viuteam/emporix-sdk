import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile: unknown) => revalidateTag(tag, profile),
}));

/** Tags only — `mock.calls.flat()` would fold the profile argument in too. */
const tagsOf = (): string[] => revalidateTag.mock.calls.map((c) => c[0] as string);

const { verifyEmporixSignature, createEmporixWebhookRoute, canonicalJson } = await import(
  "../src/webhook"
);
const { setEmporixErrorReporter, __resetEmporixErrorReporter } = await import(
  "../src/error-reporting"
);
type EmporixErrorEvent = import("../src/error-reporting").EmporixErrorEvent;

const SECRET = "whsec_test";

/**
 * Signs the way Emporix does: canonicalize the parsed body (keys sorted, nested
 * included), HMAC-SHA256, base64. See the HMAC Configuration doc page.
 */
function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(canonicalJson(JSON.parse(body))).digest("base64");
}

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://storefront.example/api/emporix/webhook", {
    method: "POST",
    body,
    headers: {
      "emporix-event-signature": sign(body),
      "emporix-event-publish-time": new Date().toISOString(),
      ...headers,
    },
  });
}

const PRODUCT_UPDATED = JSON.stringify({ type: "product.updated", payload: { id: "p1" } });

beforeEach(() => revalidateTag.mockClear());

describe("canonicalJson", () => {
  it("sorts object keys alphabetically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts nested object keys too", () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"z":{"c":2,"d":1}}');
  });

  it("preserves array order — only object keys are sorted", () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("sorts keys inside array elements", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("emits no whitespace and handles null", () => {
    expect(canonicalJson({ a: null, b: "x" })).toBe('{"a":null,"b":"x"}');
  });
});

describe("verifyEmporixSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyEmporixSignature(PRODUCT_UPDATED, sign(PRODUCT_UPDATED), SECRET)).toBe(true);
  });

  it("accepts a body whose keys arrive in a different order — canonicalization is the point", () => {
    // Same data, keys reversed and whitespace added, signed over the canonical form.
    const reordered = '{\n  "payload": { "id": "p1" },\n  "type": "product.updated"\n}';
    expect(verifyEmporixSignature(reordered, sign(PRODUCT_UPDATED), SECRET)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifyEmporixSignature(PRODUCT_UPDATED, sign(PRODUCT_UPDATED, "other"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a missing signature", () => {
    expect(verifyEmporixSignature(PRODUCT_UPDATED, null, SECRET)).toBe(false);
    expect(verifyEmporixSignature(PRODUCT_UPDATED, "", SECRET)).toBe(false);
  });

  it("rejects a signature of a different body", () => {
    const other = JSON.stringify({ type: "product.updated", payload: { id: "p2" } });
    expect(verifyEmporixSignature(PRODUCT_UPDATED, sign(other), SECRET)).toBe(false);
  });

  it("rejects a truncated signature without throwing", () => {
    const truncated = sign(PRODUCT_UPDATED).slice(0, 5);
    expect(() => verifyEmporixSignature(PRODUCT_UPDATED, truncated, SECRET)).not.toThrow();
    expect(verifyEmporixSignature(PRODUCT_UPDATED, truncated, SECRET)).toBe(false);
  });

  it("rejects an unparseable body rather than throwing", () => {
    expect(verifyEmporixSignature("not json", "whatever", SECRET)).toBe(false);
  });

  it("reports that unparseable body at warning, and still rejects it", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    expect(verifyEmporixSignature("not json", "whatever", SECRET)).toBe(false);
    expect(seen.map((e) => e.code)).toEqual(["webhook.body_unparseable"]);
    expect(seen[0]?.severity).toBe("warning");
    expect(seen[0]?.context).toEqual({ stage: "verify" });
    __resetEmporixErrorReporter();
  });

  it("canonicalize: false signs the raw bytes instead — the escape hatch", () => {
    const raw = createHmac("sha256", SECRET).update(PRODUCT_UPDATED).digest("base64");
    expect(
      verifyEmporixSignature(PRODUCT_UPDATED, raw, SECRET, { canonicalize: false }),
    ).toBe(true);
    // ...and the canonical signature is then rejected, proving the flag bites.
    expect(
      verifyEmporixSignature(PRODUCT_UPDATED, sign(PRODUCT_UPDATED), SECRET, {
        canonicalize: false,
      }),
    ).toBe(false);
  });
});

describe("createEmporixWebhookRoute", () => {
  it("revalidates the product tags on a valid product.updated", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });

    const res = await route(req(PRODUCT_UPDATED));

    expect(res.status).toBe(200);
    expect(tagsOf()).toEqual(["emporix:product:p1", "emporix:products"]);
  });

  it("passes { expire: 0 } as the default profile — immediate expiry for webhooks", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });

    await route(req(PRODUCT_UPDATED));

    expect(revalidateTag.mock.calls[0]?.[1]).toEqual({ expire: 0 });
  });

  it("honours a custom profile", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET, profile: "max" });

    await route(req(PRODUCT_UPDATED));

    expect(revalidateTag.mock.calls.length).toBeGreaterThan(0);
    for (const call of revalidateTag.mock.calls) {
      expect(call[1]).toBe("max");
    }
  });

  it("returns 401 and revalidates nothing on a bad signature", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });

    const res = await route(
      req(PRODUCT_UPDATED, { "emporix-event-signature": sign(PRODUCT_UPDATED, "wrong") }),
    );

    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 401 for a delivery older than maxAgeSeconds", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET, maxAgeSeconds: 300 });
    const old = new Date(Date.now() - 600_000).toISOString();

    const res = await route(req(PRODUCT_UPDATED, { "emporix-event-publish-time": old }));

    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("accepts a delivery inside the window", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET, maxAgeSeconds: 300 });
    const recent = new Date(Date.now() - 60_000).toISOString();

    const res = await route(req(PRODUCT_UPDATED, { "emporix-event-publish-time": recent }));

    expect(res.status).toBe(200);
  });

  it("ignores the publish time entirely when maxAgeSeconds is unset", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });
    const ancient = new Date(Date.now() - 10 * 86_400_000).toISOString();

    const res = await route(req(PRODUCT_UPDATED, { "emporix-event-publish-time": ancient }));

    expect(res.status).toBe(200);
  });

  it("calls onEvent after revalidating", async () => {
    const seen: string[] = [];
    const route = createEmporixWebhookRoute({
      secret: SECRET,
      onEvent: (e) => {
        seen.push(e.type);
      },
    });

    await route(req(PRODUCT_UPDATED));

    expect(seen).toEqual(["product.updated"]);
    expect(revalidateTag).toHaveBeenCalled();
  });

  it("returns 500 when onEvent throws, so Emporix retries", async () => {
    const route = createEmporixWebhookRoute({
      secret: SECRET,
      onEvent: () => {
        throw new Error("downstream down");
      },
    });

    const res = await route(req(PRODUCT_UPDATED));

    expect(res.status).toBe(500);
  });

  it("reports a throwing onEvent — the consumer's own handler, with the event type", async () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));
    const route = createEmporixWebhookRoute({
      secret: SECRET,
      onEvent: () => {
        throw new Error("downstream down");
      },
    });

    const res = await route(req(PRODUCT_UPDATED));

    // The degradation is unchanged: still a 500, so Emporix retries.
    expect(res.status).toBe(500);
    expect(seen.map((e) => e.code)).toEqual(["webhook.handler_failed"]);
    expect(seen[0]?.severity).toBe("error");
    expect(seen[0]?.context).toEqual({ eventType: "product.updated" });
    __resetEmporixErrorReporter();
  });

  it("returns 200 without revalidating for an unmapped event type", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });
    const body = JSON.stringify({ type: "some.unmapped.event", payload: {} });

    const res = await route(req(body));

    expect(res.status).toBe(200);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("maps category and price events too", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });

    await route(req(JSON.stringify({ type: "category.updated", payload: { id: "c1" } })));
    expect(tagsOf()).toEqual(["emporix:category:c1", "emporix:categories"]);

    revalidateTag.mockClear();
    await route(req(JSON.stringify({ type: "price.updated", payload: {} })));
    expect(tagsOf()).toEqual(["emporix:prices"]);
  });

  it("falls back to the collection tag when the payload carries no id", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });

    await route(req(JSON.stringify({ type: "product.deleted", payload: {} })));

    expect(tagsOf()).toEqual(["emporix:products"]);
  });
});
