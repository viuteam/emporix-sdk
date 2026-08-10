import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../../src/core/http";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { requestPage } from "../../src/core/paged";
import type { TokenProvider } from "../../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON",
    refreshToken: "r",
    sessionId: "s",
    expiresIn: 3599,
  }),
};

let sentTotalCount: string | null = null;
const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  sentTotalCount = null;
});
afterAll(() => server.close());

function client(): HttpClient {
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "paged" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
}

/** Answers /items with `count` rows and whatever response headers are given. */
function serveItems(count: number, headers: Record<string, string> = {}): void {
  server.use(
    mhttp.get("https://api.emporix.io/items", ({ request }) => {
      sentTotalCount = request.headers.get("X-Total-Count");
      return HttpResponse.json(
        Array.from({ length: count }, (_, i) => ({ id: `i${i}` })),
        { headers },
      );
    }),
  );
}

const GET = { method: "GET", path: "/items", auth: { kind: "service" } } as const;

describe("requestPage", () => {
  it("guesses hasNextPage from the page size when no headers come back", async () => {
    serveItems(10);
    const page = await requestPage<{ id: string }>(
      client(),
      { ...GET },
      { pageNumber: 1, pageSize: 10 },
    );
    expect(page.hasNextPage).toBe(true);
    expect(page.totalCount).toBeUndefined();
    expect(page.items).toHaveLength(10);
  });

  it("does not ask for totals unless totalCount is set", async () => {
    serveItems(3);
    await requestPage<{ id: string }>(client(), { ...GET }, { pageNumber: 1, pageSize: 10 });
    expect(sentTotalCount).toBeNull();
  });

  it("sends X-Total-Count: true and derives hasNextPage from the total", async () => {
    serveItems(10, { "X-Total-Count": "25" });
    const page = await requestPage<{ id: string }>(
      client(),
      { ...GET },
      { pageNumber: 1, pageSize: 10, totalCount: true },
    );
    expect(sentTotalCount).toBe("true");
    expect(page.totalCount).toBe(25);
    expect(page.hasNextPage).toBe(true);
  });

  it("reports the last page exactly when the total is known", async () => {
    serveItems(5, { "X-Total-Count": "25" });
    const page = await requestPage<{ id: string }>(
      client(),
      { ...GET },
      { pageNumber: 3, pageSize: 10, totalCount: true },
    );
    // 3 * 10 = 30 >= 25, so there is nothing after this page — and the guess
    // would have said the same only by accident (5 !== 10).
    expect(page.hasNextPage).toBe(false);
  });

  it("trusts X-Next-Cursor over both other tiers, even on a short page", async () => {
    serveItems(2, { "X-Next-Cursor": "cur-2", "X-Prev-Cursor": "cur-0" });
    const page = await requestPage<{ id: string }>(
      client(),
      { ...GET },
      { pageNumber: 1, pageSize: 10 },
    );
    expect(page.hasNextPage).toBe(true);
    expect(page.nextCursor).toBe("cur-2");
    expect(page.prevCursor).toBe("cur-0");
  });

  it("treats an absent cursor header as no information, not as the last page", async () => {
    // A full page with no cursor header at all: every non-schema endpoint. The
    // guess must still apply.
    serveItems(10);
    const page = await requestPage<{ id: string }>(
      client(),
      { ...GET },
      { pageNumber: 1, pageSize: 10 },
    );
    expect(page.nextCursor).toBeUndefined();
    expect(page.hasNextPage).toBe(true);
  });

  it("ignores a non-numeric X-Total-Count instead of poisoning hasNextPage", async () => {
    serveItems(10, { "X-Total-Count": "lots" });
    const page = await requestPage<{ id: string }>(
      client(),
      { ...GET },
      { pageNumber: 1, pageSize: 10, totalCount: true },
    );
    expect(page.totalCount).toBeUndefined();
    expect(page.hasNextPage).toBe(true);
  });

  it("returns an empty page rather than throwing on an empty body", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/items", () => new HttpResponse(null, { status: 204 })),
    );
    const page = await requestPage<{ id: string }>(
      client(),
      { ...GET },
      { pageNumber: 1, pageSize: 10 },
    );
    expect(page.items).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it("keeps the caller's own request headers", async () => {
    let lang: string | null = null;
    server.use(
      mhttp.get("https://api.emporix.io/items", ({ request }) => {
        lang = request.headers.get("Accept-Language");
        sentTotalCount = request.headers.get("X-Total-Count");
        return HttpResponse.json([]);
      }),
    );
    await requestPage<{ id: string }>(
      client(),
      { ...GET, headers: { "Accept-Language": "de" } },
      { pageNumber: 1, pageSize: 10, totalCount: true },
    );
    expect(lang).toBe("de");
    expect(sentTotalCount).toBe("true");
  });
});
