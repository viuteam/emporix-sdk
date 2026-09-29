import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../../src/client";

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

const CUST = { kind: "customer", token: "C" } as const;

// Each POST search outside the AI service whose spec reads parameters from the
// query string: the body it keeps, and the query parameters it must send.
const CASES: {
  name: string;
  path: string;
  call: (client: EmporixClient, input: never) => Promise<unknown>;
  body: Record<string, unknown>;
  query: Record<string, string | number | boolean>;
}[] = [
  {
    name: "companies.search",
    path: "/customer-management/acme/legal-entities/search",
    call: (c, input) => c.companies.search(input, CUST),
    body: { q: "name:Acme" },
    query: { pageNumber: 2, pageSize: 50, sort: "name:asc", fields: "id,name" },
  },
  {
    name: "customerAdmin.searchCustomers",
    path: "/customer/acme/customers/search",
    call: (c, input) => c.customerAdmin.searchCustomers(input),
    body: { q: "firstName:Jo" },
    query: { pageNumber: 2, pageSize: 50, sort: "firstName:asc", expand: "addresses" },
  },
  {
    name: "prices.search",
    path: "/price/acme/prices/search",
    call: (c, input) => c.prices.search(input),
    body: { itemIds: [{ itemId: "p1" }], currency: "CHF", siteCode: "main" },
    query: { expand: "priceModel" },
  },
  {
    name: "prices.lists.search",
    path: "/price/acme/price-lists/search",
    call: (c, input) => c.prices.lists.search(input),
    body: { q: "name:Summer" },
    query: { pageNumber: 2, pageSize: 50, sort: "name:asc" },
  },
  {
    name: "prices.lists.searchPrices",
    path: "/price/acme/price-lists/pl1/prices/search",
    call: (c, input) => c.prices.lists.searchPrices("pl1", input),
    body: { q: "itemId.id:p1" },
    query: { pageNumber: 2, pageSize: 50, sort: "itemId.id:asc" },
  },
  {
    name: "segments.search",
    path: "/customer-segment/acme/segments/search",
    call: (c, input) => c.segments.search(input),
    body: { q: "status:ACTIVE" },
    query: { pageNumber: 2, pageSize: 50, sort: "name:asc", fields: "id,name", legalEntityId: "le1", customerId: "c1" },
  },
  {
    name: "segments.customers.search",
    path: "/customer-segment/acme/segments/s1/customers/search",
    call: (c, input) => c.segments.customers.search("s1", input),
    body: { q: "customer.id:c1" },
    query: { pageNumber: 2, pageSize: 50, sort: "customer.id:asc", fields: "customer" },
  },
  {
    name: "segments.groups.search",
    path: "/customer-segment/acme/segments/s1/groups/search",
    call: (c, input) => c.segments.groups.search("s1", input),
    body: { q: "group.id:g1" },
    query: { pageNumber: 2, pageSize: 50, sort: "group.id:asc", fields: "group" },
  },
  {
    name: "segments.items.search",
    path: "/customer-segment/acme/segments/s1/items/search",
    call: (c, input) => c.segments.items.search("s1", input),
    body: { q: "type:PRODUCT" },
    query: { pageNumber: 2, pageSize: 50, sort: "item.id:asc", fields: "item", legalEntityId: "le1" },
  },
  {
    name: "vendors.searchVendors",
    path: "/vendor/acme/vendors/search",
    call: (c, input) => c.vendors.searchVendors(input),
    body: { q: "name:Supplier" },
    query: { pageNumber: 2, pageSize: 50, sort: "name:asc", fields: "id,name" },
  },
  {
    // This endpoint takes its paging in the body; only siteFallback is a query parameter.
    name: "fees.searchItemFeesByProductIds",
    path: "/fee/acme/itemFees/searchByProductIds",
    call: (c, input) => c.fees.searchItemFeesByProductIds(input),
    body: { productIds: "p1,p2", siteCode: "main", pageNumber: 2, pageSize: 50 },
    query: { siteFallback: true },
  },
];

describe("search query parameters", () => {
  it.each(CASES.map((c) => [c.name, c] as const))(
    "%s sends its query parameters in the query string, the rest as the body, and nothing extra when unset",
    async (_name, c) => {
      const seen: { query: Record<string, string>; body: unknown }[] = [];
      server.use(
        http.post(`https://api.emporix.io${c.path}`, async ({ request }) => {
          seen.push({
            query: Object.fromEntries(new URL(request.url).searchParams),
            body: await request.json(),
          });
          return HttpResponse.json([]);
        }),
      );
      const client = sdk();
      await c.call(client, { ...c.body, ...c.query } as never);
      await c.call(client, c.body as never);
      const asSent = Object.fromEntries(Object.entries(c.query).map(([k, v]) => [k, String(v)]));
      expect(seen).toEqual([
        { query: asSent, body: c.body },
        { query: {}, body: c.body },
      ]);
    },
  );
});
