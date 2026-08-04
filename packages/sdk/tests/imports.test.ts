import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../src/client";
import { iterateAll } from "../src/core/context";

const TENANT = "acme";
const BASE = `https://api.emporix.io/importtool/${TENANT}`;

const config = { id: "cfg1", tenant: TENANT, name: "Suppliers", deltaEnabled: true, enabled: true };
const stream = { id: "str1", configId: "cfg1", name: "Products", mode: "STANDALONE", enabled: true };
const run = { id: "run1", configId: "cfg1", status: "SUCCEEDED", mode: "DELTA", recordsRead: 12 };
const schedule = { id: "sch1", configId: "cfg1", cron: "0 0 3 * * *", timezone: "Europe/Zurich", enabled: true };

/** A Spring page, as the import service returns it. `number` is zero-based. */
function wirePage<T>(content: T[], over: Partial<Record<string, number>> = {}) {
  return {
    content,
    totalElements: over.totalElements ?? content.length,
    totalPages: over.totalPages ?? 1,
    number: over.number ?? 0,
    size: over.size ?? 50,
  };
}

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

describe("ImportService configurations and streams", () => {
  it("listConfigs GETs /configs with the service token", async () => {
    let authHeader: string | null = null;
    server.use(
      http.get(`${BASE}/configs`, ({ request }) => {
        authHeader = request.headers.get("Authorization");
        return HttpResponse.json([config]);
      }),
    );
    const res = await sdk().imports.listConfigs();
    expect(res).toEqual([config]);
    expect(authHeader).toBe("Bearer svc");
  });

  it("getConfig encodes the id into the path", async () => {
    server.use(
      http.get(`${BASE}/configs/cfg%2F1`, () => HttpResponse.json({ ...config, id: "cfg/1" })),
    );
    const res = await sdk().imports.getConfig("cfg/1");
    expect(res.id).toBe("cfg/1");
  });

  it("listStreams GETs the configuration's streams", async () => {
    server.use(http.get(`${BASE}/configs/cfg1/streams`, () => HttpResponse.json([stream])));
    expect(await sdk().imports.listStreams("cfg1")).toEqual([stream]);
  });

  it("getStream GETs /streams/{id}", async () => {
    server.use(http.get(`${BASE}/streams/str1`, () => HttpResponse.json(stream)));
    expect((await sdk().imports.getStream("str1")).name).toBe("Products");
  });
});

describe("ImportService schedules", () => {
  it("getSchedule returns the schedule on 200", async () => {
    server.use(http.get(`${BASE}/configs/cfg1/schedule`, () => HttpResponse.json(schedule)));
    const res = await sdk().imports.getSchedule("cfg1");
    expect(res?.cron).toBe("0 0 3 * * *");
  });

  it("getSchedule returns null on 204 — an unscheduled config is not an error", async () => {
    server.use(
      http.get(`${BASE}/configs/cfg1/schedule`, () => new HttpResponse(null, { status: 204 })),
    );
    expect(await sdk().imports.getSchedule("cfg1")).toBeNull();
  });

  it("setSchedule PUTs the body", async () => {
    let received: unknown;
    server.use(
      http.put(`${BASE}/configs/cfg1/schedule`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(schedule);
      }),
    );
    const res = await sdk().imports.setSchedule("cfg1", {
      cron: "0 0 3 * * *",
      timezone: "Europe/Zurich",
    });
    expect(received).toEqual({ cron: "0 0 3 * * *", timezone: "Europe/Zurich" });
    expect(res.id).toBe("sch1");
  });
});

describe("ImportService runs", () => {
  it("triggerRun POSTs mode and dryRun", async () => {
    let received: unknown;
    server.use(
      http.post(`${BASE}/configs/cfg1/runs`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ ...run, status: "QUEUED", mode: "FULL" }, { status: 202 });
      }),
    );
    const res = await sdk().imports.triggerRun("cfg1", { mode: "FULL", dryRun: true });
    expect(received).toEqual({ mode: "FULL", dryRun: true });
    expect(res.status).toBe("QUEUED");
  });

  it("triggerRun without input POSTs an empty body and lets the service default the mode", async () => {
    let received: unknown;
    server.use(
      http.post(`${BASE}/configs/cfg1/runs`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(run, { status: 202 });
      }),
    );
    await sdk().imports.triggerRun("cfg1");
    expect(received).toEqual({});
  });

  it("listRuns sends a zero-based page and reports a one-based pageNumber", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/configs/cfg1/runs`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(
          wirePage([run], { number: 2, size: 10, totalElements: 25, totalPages: 3 }),
        );
      }),
    );
    const page = await sdk().imports.listRuns("cfg1", { pageNumber: 3, pageSize: 10 });
    expect(new URL(url).searchParams.get("page")).toBe("2");
    expect(new URL(url).searchParams.get("size")).toBe("10");
    expect(page).toEqual({
      items: [run],
      pageNumber: 3,
      pageSize: 10,
      hasNextPage: false,
      totalElements: 25,
      totalPages: 3,
    });
  });

  it("listRuns defaults to page 1 / size 50", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/configs/cfg1/runs`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(wirePage([run]));
      }),
    );
    await sdk().imports.listRuns("cfg1");
    const q = new URL(url).searchParams;
    expect([q.get("page"), q.get("size")]).toEqual(["0", "50"]);
  });

  it("hasNextPage comes from totalPages, not from a full page", async () => {
    server.use(
      http.get(`${BASE}/configs/cfg1/runs`, () =>
        // A completely full page that is nevertheless the last one — the
        // items.length === pageSize guess used elsewhere would get this wrong.
        HttpResponse.json(wirePage([run, run], { size: 2, totalElements: 2, totalPages: 1 })),
      ),
    );
    expect((await sdk().imports.listRuns("cfg1", { pageSize: 2 })).hasNextPage).toBe(false);
  });

  it("reports the size the service actually used, not the one requested", async () => {
    server.use(
      http.get(`${BASE}/configs/cfg1/runs`, () =>
        HttpResponse.json(wirePage([run], { size: 100, totalElements: 1, totalPages: 1 })),
      ),
    );
    expect((await sdk().imports.listRuns("cfg1", { pageSize: 5000 })).pageSize).toBe(100);
  });

  it("an empty page yields empty items rather than undefined", async () => {
    server.use(
      http.get(`${BASE}/configs/cfg1/runs`, () =>
        HttpResponse.json({ totalElements: 0, totalPages: 0, number: 0, size: 50 }),
      ),
    );
    const page = await sdk().imports.listRuns("cfg1");
    expect(page.items).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it("an ImportPage feeds iterateAll unchanged", async () => {
    server.use(
      http.get(`${BASE}/configs/cfg1/runs`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        return HttpResponse.json(
          wirePage([{ ...run, id: `run${page + 1}` }], {
            number: page,
            size: 1,
            totalElements: 2,
            totalPages: 2,
          }),
        );
      }),
    );
    const client = sdk();
    const ids: string[] = [];
    for await (const r of iterateAll((pageNumber) =>
      client.imports.listRuns("cfg1", { pageNumber, pageSize: 1 }),
    )) {
      ids.push(r.id!);
    }
    expect(ids).toEqual(["run1", "run2"]);
  });

  it("getRun returns the run with its per-stream progress", async () => {
    server.use(
      http.get(`${BASE}/runs/run1`, () =>
        HttpResponse.json({ run, streams: [{ id: "rs1", runId: "run1", status: "SUCCEEDED" }] }),
      ),
    );
    const res = await sdk().imports.getRun("run1");
    expect(res.run?.id).toBe("run1");
    expect(res.streams).toHaveLength(1);
  });

  it("cancelRun sends force=true only when asked", async () => {
    const urls: string[] = [];
    server.use(
      http.post(`${BASE}/runs/run1/cancel`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ runId: "run1", force: true, accepted: true });
      }),
    );
    const client = sdk();
    await client.imports.cancelRun("run1");
    await client.imports.cancelRun("run1", { force: true });
    expect(new URL(urls[0]!).searchParams.get("force")).toBeNull();
    expect(new URL(urls[1]!).searchParams.get("force")).toBe("true");
  });

  it("cancelRun surfaces accepted:false as a normal result", async () => {
    server.use(
      http.post(`${BASE}/runs/run1/cancel`, () =>
        HttpResponse.json({ runId: "run1", accepted: false }),
      ),
    );
    expect((await sdk().imports.cancelRun("run1")).accepted).toBe(false);
  });

  it("listRunErrors pages the run's errors", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/runs/run1/errors`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(
          wirePage([{ id: "e1", runId: "run1", errorCode: "MAPPING", message: "bad price" }], {
            number: 1,
            size: 20,
            totalElements: 30,
            totalPages: 2,
          }),
        );
      }),
    );
    const page = await sdk().imports.listRunErrors("run1", { pageNumber: 2, pageSize: 20 });
    expect(new URL(url).searchParams.get("page")).toBe("1");
    expect(page.items[0]?.errorCode).toBe("MAPPING");
    expect(page.totalElements).toBe(30);
    expect(page.hasNextPage).toBe(false);
  });
});

describe("ImportService data", () => {
  it("listDataTypes returns the target types", async () => {
    server.use(http.get(`${BASE}/data/types`, () => HttpResponse.json(["supplier", "product"])));
    expect(await sdk().imports.listDataTypes()).toEqual(["supplier", "product"]);
  });

  it("searchRecords passes type, search and outcome through", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/data/records`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(
          wirePage([{ id: "r1", naturalKey: "SKU-1", outcome: "UPSERTED" }]),
        );
      }),
    );
    const page = await sdk().imports.searchRecords({
      type: "supplier",
      search: "SKU",
      outcome: "UPSERTED",
    });
    const q = new URL(url).searchParams;
    expect(q.get("type")).toBe("supplier");
    expect(q.get("search")).toBe("SKU");
    expect(q.get("outcome")).toBe("UPSERTED");
    expect(page.items[0]?.naturalKey).toBe("SKU-1");
  });

  it("searchRecords omits search and outcome when unset", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/data/records`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(wirePage([]));
      }),
    );
    await sdk().imports.searchRecords({ type: "supplier" });
    const q = new URL(url).searchParams;
    expect(q.has("search")).toBe(false);
    expect(q.has("outcome")).toBe(false);
  });

  it("searchStreamRecords scopes the search to one stream", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/data/streams/str1/records`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(wirePage([{ id: "r1", streamId: "str1", outcome: "DRY_RUN" }]));
      }),
    );
    const page = await sdk().imports.searchStreamRecords("str1", { outcome: "DRY_RUN" });
    expect(new URL(url).searchParams.get("outcome")).toBe("DRY_RUN");
    expect(page.items[0]?.streamId).toBe("str1");
  });
});
