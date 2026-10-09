import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../../src/client";
import { SearchService } from "../../src/services/search";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function sdk() {
  return new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
}

const BASE = "https://api.emporix.io/search/acme";

describe("SearchService", () => {
  it("is wired as client.search", () => {
    expect(sdk().search).toBeInstanceOf(SearchService);
  });

  it("search POSTs the body and sends paging, sort and fields as query parameters", async () => {
    let seen: { url: URL; body: unknown; auth: string | null; count: string | null } | undefined;
    server.use(
      http.post(`${BASE}/search/my%20type`, async ({ request }) => {
        seen = {
          url: new URL(request.url),
          body: await request.json(),
          auth: request.headers.get("authorization"),
          count: request.headers.get("x-total-count"),
        };
        return HttpResponse.json([{ id: "d1", _score: 4.2 }], { headers: { "X-Total-Count": "61" } });
      }),
    );
    const input = {
      index: "vehicles",
      queries: [{ type: "TEXT" as const, query: "diesel", field: "name.en" }],
      filters: { field: "status", operator: "EQ" as const, value: "ACTIVE" },
    };
    const page = await sdk().search.search("my type", input, {
      pageNumber: 1,
      pageSize: 60,
      sort: "name:ASC",
      fields: "id,_score",
      totalCount: true,
    });
    expect(seen?.body).toEqual(input);
    expect(seen?.auth).toBe("Bearer svc-tok");
    expect(seen?.count).toBe("true");
    expect(Object.fromEntries(seen?.url.searchParams ?? [])).toEqual({
      pageNumber: "1",
      pageSize: "60",
      sort: "name:ASC",
      fields: "id,_score",
    });
    expect(page).toMatchObject({ items: [{ id: "d1" }], totalCount: 61, hasNextPage: true });
  });

  it("search omits sort, fields and the count header when unset", async () => {
    let seen: { url: URL; count: string | null } | undefined;
    server.use(
      http.post(`${BASE}/search/vehicle`, ({ request }) => {
        seen = { url: new URL(request.url), count: request.headers.get("x-total-count") };
        return HttpResponse.json([]);
      }),
    );
    await sdk().search.search("vehicle", { searchQueryId: "red-cars", query: "diesel" });
    expect(Object.fromEntries(seen?.url.searchParams ?? [])).toEqual({ pageNumber: "1", pageSize: "60" });
    expect(seen?.count).toBeNull();
  });

  it("listSavedSearches and listIndexes scope to one type, or span every type", async () => {
    const seen: string[] = [];
    const record = ({ request }: { request: Request }) => {
      const u = new URL(request.url);
      seen.push(`${u.pathname}?${u.searchParams.toString()}`);
      return HttpResponse.json([]);
    };
    server.use(
      http.get(`${BASE}/search/queries`, record),
      http.get(`${BASE}/search/vehicle/queries`, record),
      http.get(`${BASE}/search/indexes`, record),
      http.get(`${BASE}/search/vehicle/indexes`, record),
    );
    const s = sdk().search;
    await s.listSavedSearches({ type: "vehicle", q: "indexId:vehicles" });
    await s.listSavedSearches();
    await s.listIndexes({ type: "vehicle", fields: "id,status" });
    await s.listIndexes();
    expect(seen).toEqual([
      "/search/acme/search/vehicle/queries?pageNumber=1&pageSize=60&q=indexId%3Avehicles",
      "/search/acme/search/queries?pageNumber=1&pageSize=60",
      "/search/acme/search/vehicle/indexes?pageNumber=1&pageSize=60&fields=id%2Cstatus",
      "/search/acme/search/indexes?pageNumber=1&pageSize=60",
    ]);
  });

  it("upsertSavedSearch resolves to the id on 201 and to undefined on 204", async () => {
    let body: unknown;
    let created = true;
    server.use(
      http.put(`${BASE}/search/vehicle/queries/red-cars`, async ({ request }) => {
        body = await request.json();
        return created
          ? HttpResponse.json({ id: "red-cars" }, { status: 201 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    const input = { index: "vehicles", queries: { type: "TEXT" as const, query: "red", field: "name.en" } };
    await expect(sdk().search.upsertSavedSearch("vehicle", "red-cars", input)).resolves.toEqual({ id: "red-cars" });
    expect(body).toEqual(input);
    created = false;
    await expect(
      sdk().search.upsertSavedSearch("vehicle", "red-cars", { ...input, metadata: { version: 1 } }),
    ).resolves.toBeUndefined();
  });

  it("upsertIndex resolves to the job id on 202 and to undefined on 204; deleteIndex to the job id", async () => {
    let started = true;
    server.use(
      http.put(`${BASE}/search/vehicle/indexes/vehicles`, () =>
        started ? HttpResponse.json({ id: "job1" }, { status: 202 }) : new HttpResponse(null, { status: 204 }),
      ),
      http.delete(`${BASE}/search/vehicle/indexes/vehicles`, () => HttpResponse.json({ id: "job2" }, { status: 202 })),
    );
    const input = { fields: [{ path: "name.en", text: true }] };
    await expect(sdk().search.upsertIndex("vehicle", "vehicles", input)).resolves.toEqual({ id: "job1" });
    started = false;
    await expect(sdk().search.upsertIndex("vehicle", "vehicles", input)).resolves.toBeUndefined();
    await expect(sdk().search.deleteIndex("vehicle", "vehicles")).resolves.toEqual({ id: "job2" });
  });

  it("exportIndexes POSTs the selection; importIndexes POSTs the package unchanged", async () => {
    const seen: { path: string; body: unknown }[] = [];
    const pkg = { exportedAt: "2026-03-12T10:00:00.000Z", data: "W10=" };
    server.use(
      http.post(`${BASE}/search/indexes/export`, async ({ request }) => {
        seen.push({ path: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json(pkg);
      }),
      http.post(`${BASE}/search/indexes/import`, async ({ request }) => {
        seen.push({ path: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json([{ id: "vehicles", type: "vehicle", jobId: "job1", jobType: "create_index" }]);
      }),
    );
    const s = sdk().search;
    const exported = await s.exportIndexes([{ type: "vehicle", id: "vehicles" }]);
    expect(exported).toEqual(pkg);
    await expect(s.importIndexes(exported)).resolves.toEqual([
      { id: "vehicles", type: "vehicle", jobId: "job1", jobType: "create_index" },
    ]);
    expect(seen).toEqual([
      { path: "/search/acme/search/indexes/export", body: [{ type: "vehicle", id: "vehicles" }] },
      { path: "/search/acme/search/indexes/import", body: pkg },
    ]);
  });

  it("deleteSavedSearch DELETEs and resolves to undefined", async () => {
    let hit = false;
    server.use(
      http.delete(`${BASE}/search/vehicle/queries/red-cars`, () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(sdk().search.deleteSavedSearch("vehicle", "red-cars")).resolves.toBeUndefined();
    expect(hit).toBe(true);
  });

  it("the single reads forward fields, and omit it when unset", async () => {
    const seen: (string | null)[] = [];
    const record = ({ request }: { request: Request }) => {
      seen.push(new URL(request.url).searchParams.get("fields"));
      return HttpResponse.json({ id: "x" });
    };
    server.use(
      http.get(`${BASE}/search/vehicle/queries/red-cars`, record),
      http.get(`${BASE}/search/vehicle/indexes/vehicles`, record),
      http.get(`${BASE}/jobs/job1`, record),
    );
    const s = sdk().search;
    await s.getSavedSearch("vehicle", "red-cars", { fields: "id,name" });
    await s.getSavedSearch("vehicle", "red-cars");
    await s.getIndex("vehicle", "vehicles", { fields: "id,status" });
    await s.getIndex("vehicle", "vehicles");
    await s.getJob("job1", { fields: "id,status" });
    await s.getJob("job1");
    expect(seen).toEqual(["id,name", null, "id,status", null, "id,status", null]);
  });

  it("listJobs GETs the tenant's jobs with paging", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}/jobs`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([{ id: "job1", status: "in_progress" }]);
      }),
    );
    const page = await sdk().search.listJobs({ pageNumber: 2, pageSize: 10, sort: "metadata.createdAt:DESC" });
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      pageNumber: "2",
      pageSize: "10",
      sort: "metadata.createdAt:DESC",
    });
    expect(page.items).toEqual([{ id: "job1", status: "in_progress" }]);
  });
});
