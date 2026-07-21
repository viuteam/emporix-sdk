import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { DefaultTokenProvider } from "../src/core/auth";
import { LevelResolver } from "../src/core/logger";
import { EmporixForbiddenError } from "../src/core/errors";
import { MemoryLogger } from "./helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  return new HttpClient({
    host: "https://api.emporix.io",
    provider: new DefaultTokenProvider(cfg),
    logger: new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "t" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
}

const URL = "https://api.emporix.io/stream";

describe("HttpClient.requestStream", () => {
  it("yields parsed SSE events from a text/event-stream body", async () => {
    server.use(
      http.post(URL, () => {
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("data: one\n\n"));
            c.enqueue(new TextEncoder().encode("data: two\n\n"));
            c.close();
          },
        });
        return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const events: string[] = [];
    for await (const e of client().requestStream({ method: "POST", path: "/stream", auth: { kind: "service" } })) {
      events.push(e.data);
    }
    expect(events).toEqual(["one", "two"]);
  });

  it("maps a non-2xx status to a typed error before streaming", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ message: "nope" }, { status: 403 })));
    await expect(async () => {
      for await (const _ of client().requestStream({ method: "POST", path: "/stream", auth: { kind: "service" } })) {
        /* unreachable */
      }
    }).rejects.toBeInstanceOf(EmporixForbiddenError);
  });
});
