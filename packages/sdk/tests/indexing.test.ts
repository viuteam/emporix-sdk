import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../src/client";

const TENANT = "acme";
const job = {
  id: "job1",
  status: "IN_PROGRESS",
  entityType: "PRODUCT",
  metadata: { createdAt: "2026-06-16T12:32:14.132Z", modifiedAt: "2026-06-16T12:32:14.150Z" },
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

describe("IndexingService reindex jobs", () => {
  it("createReindexJob posts the body and returns the job (201)", async () => {
    let received: unknown;
    server.use(
      http.post(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(job, { status: 201 });
      }),
    );
    const res = await sdk().indexing.createReindexJob({ entityType: "PRODUCT", rag: true });
    expect(received).toEqual({ entityType: "PRODUCT", rag: true });
    expect(res.id).toBe("job1");
    expect(res.status).toBe("IN_PROGRESS");
  });

  it("createReindexJob handles the 200 already-in-progress response", async () => {
    server.use(
      http.post(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs`, () =>
        HttpResponse.json(job, { status: 200 }),
      ),
    );
    const res = await sdk().indexing.createReindexJob({ entityType: "PRODUCT" });
    expect(res.id).toBe("job1");
  });

  it("listReindexJobs returns a PaginatedItems shape", async () => {
    server.use(
      http.get(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs`, () =>
        HttpResponse.json([job]),
      ),
    );
    const page = await sdk().indexing.listReindexJobs({ pageSize: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(50);
    expect(page.hasNextPage).toBe(false);
  });

  it("getReindexJob fetches one job by id", async () => {
    server.use(
      http.get(`https://api.emporix.io/indexing/${TENANT}/reindex-jobs/job1`, () =>
        HttpResponse.json(job),
      ),
    );
    const res = await sdk().indexing.getReindexJob("job1");
    expect(res.entityType).toBe("PRODUCT");
  });
});
