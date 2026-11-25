import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../../src/client";

const TENANT = "acme";
const URL_CHANGELOGS = `https://api.emporix.io/changelog/${TENANT}/changelogs`;

const entry = {
  at: "2026-06-01T13:01:29.123Z",
  type: "update",
  entity: "order",
  entityId: "6a2bce93592855a33518fc2f",
  paths: { status: { before: "CREATED", after: "CONFIRMED" } },
  schemaVersion: "v2",
  actor: "John Doe",
};

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc", token_type: "Bearer", expires_in: 3600 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function sdk() {
  return new EmporixClient({
    tenant: TENANT,
    credentials: { backend: { clientId: "b", secret: "s" } },
    logger: false,
  });
}

function envelope(over: Record<string, unknown> = {}) {
  return { items: [entry], page: 1, size: 20, totalElements: 1, totalPages: 1, ...over };
}

describe("AuditLogService.list", () => {
  it("reads the tenant path with the service token", async () => {
    const seen: { auth?: string | null } = {};
    server.use(
      http.get(URL_CHANGELOGS, ({ request }) => {
        seen.auth = request.headers.get("authorization");
        return HttpResponse.json(envelope());
      }),
    );
    const page = await sdk().auditLogs.list();
    expect(seen.auth).toBe("Bearer svc");
    expect(page.items[0]?.entityId).toBe("6a2bce93592855a33518fc2f");
  });

  it("maps the body envelope onto the SDK page shape", async () => {
    server.use(
      http.get(URL_CHANGELOGS, () =>
        HttpResponse.json(envelope({ page: 2, size: 50, totalElements: 137, totalPages: 3 })),
      ),
    );
    const page = await sdk().auditLogs.list({ pageNumber: 2, pageSize: 50 });
    expect(page.pageNumber).toBe(2);
    expect(page.pageSize).toBe(50);
    expect(page.totalElements).toBe(137);
    expect(page.totalPages).toBe(3);
    expect(page.hasNextPage).toBe(true);
  });

  it("reports no next page on the last one", async () => {
    server.use(
      http.get(URL_CHANGELOGS, () =>
        HttpResponse.json(envelope({ page: 3, size: 50, totalElements: 137, totalPages: 3 })),
      ),
    );
    expect((await sdk().auditLogs.list({ pageNumber: 3 })).hasNextPage).toBe(false);
  });

  // The page is 1-based on this endpoint, unlike the import service's 0-based
  // Spring pages. `page === totalPages` is the LAST page, not the second-to-last.
  it("trusts the server's echo over what was requested", async () => {
    server.use(
      http.get(URL_CHANGELOGS, () => HttpResponse.json(envelope({ page: 1, size: 20 }))),
    );
    const page = await sdk().auditLogs.list({ pageNumber: 9, pageSize: 100 });
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(20);
  });

  // `size=` would be a 400 here (it must be 1..100), and an empty `q=` is a real
  // filter, not an absent one.
  it("omits absent options instead of sending them empty", async () => {
    const seen: { url?: URL } = {};
    server.use(
      http.get(URL_CHANGELOGS, ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(envelope());
      }),
    );
    await sdk().auditLogs.list();
    expect(seen.url?.searchParams.has("q")).toBe(false);
    expect(seen.url?.searchParams.has("page")).toBe(false);
    expect(seen.url?.searchParams.has("size")).toBe(false);
  });

  it("forwards the q filter verbatim, quotes and comparisons included", async () => {
    const q =
      'actor:"Jane Doe" occurredAt:(>"2026-06-01T00:00:00.000Z" AND <"2026-07-01T00:00:00.000Z")';
    const seen: { q?: string | null } = {};
    server.use(
      http.get(URL_CHANGELOGS, ({ request }) => {
        seen.q = new URL(request.url).searchParams.get("q");
        return HttpResponse.json(envelope());
      }),
    );
    await sdk().auditLogs.list({ q });
    expect(seen.q).toBe(q);
  });

  it("keeps the before/after paths and related entities of an entry", async () => {
    server.use(
      http.get(URL_CHANGELOGS, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                at: "2026-06-01T10:00:00.000Z",
                type: "create",
                entity: "group-assignment",
                entityId: "264e59c0-0130-4f1b-a83f-cea06264a397",
                actor: "system",
                related: [
                  { entity: "group", entityId: "1gr5e52e-6e27-4ac5-9471-2467d3fb7501" },
                  { entity: "customer", entityId: "cd6818c8-ec9b-42d4-83c4-8c51dfbe9ce0" },
                ],
              },
            ],
          }),
        ),
      ),
    );
    const [row] = (await sdk().auditLogs.list({ q: "entity:group-assignment" })).items;
    expect(row?.type).toBe("create");
    expect(row?.related).toHaveLength(2);
    expect(row?.related?.[0]?.entity).toBe("group");
  });

  it("survives a preview response that omits the paging fields", async () => {
    server.use(http.get(URL_CHANGELOGS, () => HttpResponse.json({})));
    const page = await sdk().auditLogs.list();
    expect(page.items).toEqual([]);
    expect(page.pageNumber).toBe(1);
    expect(page.totalElements).toBe(0);
    expect(page.hasNextPage).toBe(false);
  });

  // Offset mode is the service default; `list` must not opt into cursor mode.
  it("does not send a pagination mode", async () => {
    const seen: { url?: URL } = {};
    server.use(
      http.get(URL_CHANGELOGS, ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(envelope());
      }),
    );
    await sdk().auditLogs.list({ pageNumber: 2 });
    expect(seen.url?.searchParams.has("pagination")).toBe(false);
  });
});

describe("AuditLogService.listByCursor", () => {
  it("selects cursor mode on the first page and leaves page/cursors off the wire", async () => {
    const seen: { url?: URL; auth?: string | null } = {};
    server.use(
      http.get(URL_CHANGELOGS, ({ request }) => {
        seen.url = new URL(request.url);
        seen.auth = request.headers.get("authorization");
        return HttpResponse.json({ items: [entry] });
      }),
    );
    await sdk().auditLogs.listByCursor();
    expect(seen.auth).toBe("Bearer svc");
    expect(seen.url?.searchParams.get("pagination")).toBe("cursor");
    for (const name of ["q", "size", "page", "next", "prev"]) {
      expect(seen.url?.searchParams.has(name)).toBe(false);
    }
  });

  it("forwards q, size and the next cursor", async () => {
    const seen: { url?: URL } = {};
    server.use(
      http.get(URL_CHANGELOGS, ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json({ items: [] });
      }),
    );
    await sdk().auditLogs.listByCursor({ q: "entity:order", pageSize: 50, next: "abc==" });
    expect(seen.url?.searchParams.get("q")).toBe("entity:order");
    expect(seen.url?.searchParams.get("size")).toBe("50");
    expect(seen.url?.searchParams.get("next")).toBe("abc==");
    expect(seen.url?.searchParams.has("prev")).toBe(false);
  });

  it("forwards the prev cursor", async () => {
    const seen: { prev?: string | null; next?: string | null } = {};
    server.use(
      http.get(URL_CHANGELOGS, ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.prev = params.get("prev");
        seen.next = params.get("next");
        return HttpResponse.json({ items: [] });
      }),
    );
    await sdk().auditLogs.listByCursor({ prev: "xyz" });
    expect(seen.prev).toBe("xyz");
    expect(seen.next).toBeNull();
  });

  it("reads both cursors from the response headers", async () => {
    server.use(
      http.get(URL_CHANGELOGS, () =>
        HttpResponse.json(
          { items: [entry] },
          { headers: { "x-next-cursor": "older", "x-prev-cursor": "newer" } },
        ),
      ),
    );
    const page = await sdk().auditLogs.listByCursor({ next: "c1" });
    expect(page.items[0]?.entityId).toBe("6a2bce93592855a33518fc2f");
    expect(page.nextCursor).toBe("older");
    expect(page.prevCursor).toBe("newer");
    expect(page.hasNextPage).toBe(true);
  });

  it("reports the last page when no x-next-cursor comes back", async () => {
    server.use(http.get(URL_CHANGELOGS, () => HttpResponse.json({ items: [entry] })));
    const page = await sdk().auditLogs.listByCursor();
    expect(page.hasNextPage).toBe(false);
    expect("nextCursor" in page).toBe(false);
    expect("prevCursor" in page).toBe(false);
  });

  it("survives an empty body", async () => {
    server.use(http.get(URL_CHANGELOGS, () => HttpResponse.json({})));
    expect((await sdk().auditLogs.listByCursor()).items).toEqual([]);
  });
});
