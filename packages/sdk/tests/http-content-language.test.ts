import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient, type RequestOptions } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import type { TokenProvider } from "../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON",
    refreshToken: "r",
    sessionId: "s",
    expiresIn: 3599,
  }),
};

let contentLanguage: string | null | undefined;
const server = setupServer(
  mhttp.all("https://api.emporix.io/echo", ({ request }) => {
    contentLanguage = request.headers.get("content-language");
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  contentLanguage = undefined;
});
afterAll(() => server.close());

function client(contentLanguageDefault?: string) {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "product" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
    ...(contentLanguageDefault !== undefined ? { contentLanguage: contentLanguageDefault } : {}),
  });
}

const SERVICE = { kind: "service" } as const;

describe("HttpClient Content-Language", () => {
  it.each(["POST", "PUT", "PATCH"] as const)(
    "sends the configured contentLanguage on a %s with a JSON body",
    async (method) => {
      await client("*").request({ method, path: "/echo", auth: SERVICE, body: { name: { de: "Stuhl" } } });
      expect(contentLanguage).toBe("*");
    },
  );

  it("sends it on a multipart write too", async () => {
    const body = new FormData();
    body.set("body", JSON.stringify({ name: { de: "Stuhl" } }));
    await client("*").request({ method: "POST", path: "/echo", auth: SERVICE, body });
    expect(contentLanguage).toBe("*");
  });

  it.each<Pick<RequestOptions, "method">>([{ method: "GET" }, { method: "DELETE" }])(
    "omits it on a $method without a body",
    async ({ method }) => {
      await client("*").request({ method, path: "/echo", auth: SERVICE });
      expect(contentLanguage).toBeNull();
    },
  );

  it("omits it when no contentLanguage is configured", async () => {
    await client().request({ method: "POST", path: "/echo", auth: SERVICE, body: { name: "Stuhl" } });
    expect(contentLanguage).toBeNull();
  });

  it("lets a per-request header override the configured default", async () => {
    await client("*").request({
      method: "PATCH",
      path: "/echo",
      auth: SERVICE,
      body: { name: "Stuhl" },
      headers: { "Content-Language": "de" },
    });
    expect(contentLanguage).toBe("de");
  });
});
