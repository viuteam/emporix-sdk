import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { schemaService } from "../src/codegen/adapters/schema-service";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// minimal fake client: only the bits the adapter uses
function fakeClient(schemas: unknown[]) {
  return {
    schemas: {
      listSchemas: async () => ({ items: schemas, total: schemas.length }),
    },
  } as never;
}
const AUTH = { kind: "service" as const };

describe("schemaService adapter", () => {
  it("fetches the hosted JSON Schema per schema (one RawMixin per type)", async () => {
    server.use(
      http.get("https://cdn/deliveryOptions.v6.json", () =>
        HttpResponse.json({ type: "object", properties: { packaging: { type: "string" } } }),
      ),
    );
    const client = fakeClient([
      {
        id: "deliveryOptions",
        types: ["CUSTOMER", "ORDER"],
        metadata: { version: 6, url: "https://cdn/deliveryOptions.v6.json" },
        attributes: [],
      },
    ]);
    const raw = await schemaService({ client, auth: AUTH }).list();
    expect(raw).toHaveLength(2); // one per type
    expect(raw[0]!).toMatchObject({
      key: "deliveryOptions",
      entity: "CUSTOMER",
      version: 6,
      url: "https://cdn/deliveryOptions.v6.json",
    });
    expect(raw[0]!.schema).toMatchObject({ type: "object" });
  });

  it("falls back to attribute conversion when the URL fetch fails", async () => {
    server.use(http.get("https://cdn/x.v1.json", () => new HttpResponse(null, { status: 404 })));
    const client = fakeClient([
      {
        id: "x",
        types: ["CART"],
        metadata: { version: 1, url: "https://cdn/x.v1.json" },
        attributes: [{ key: "note", type: "TEXT", required: true }],
      },
    ]);
    const raw = await schemaService({ client, auth: AUTH }).list();
    expect(raw[0]!.schema).toMatchObject({
      type: "object",
      required: ["note"],
      properties: { note: { type: "string" } },
    });
  });

  it("forwards the auth context to listSchemas", async () => {
    let received: unknown;
    const client = {
      schemas: {
        listSchemas: async (_q: unknown, a: unknown) => {
          received = a;
          return { items: [] };
        },
      },
    } as never;
    await schemaService({ client, auth: { kind: "anonymous" } }).list();
    expect(received).toEqual({ kind: "anonymous" });
  });

  it("skips incomplete schemas and defaults entity to UNKNOWN when no types", async () => {
    server.use(http.get("https://cdn/ok.v2.json", () => HttpResponse.json({ type: "object" })));
    const client = fakeClient([
      { id: "incomplete", metadata: { version: 1 } }, // no url → skipped
      { id: "ok", metadata: { version: 2, url: "https://cdn/ok.v2.json" } }, // no types → UNKNOWN
    ]);
    const raw = await schemaService({ client }).list();
    expect(raw).toHaveLength(1);
    expect(raw[0]!).toMatchObject({ key: "ok", entity: "UNKNOWN", version: 2 });
  });
});
