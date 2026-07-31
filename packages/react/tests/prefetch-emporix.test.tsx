import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { prefetchEmporix } from "../src/ssr";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useSites } from "../src/hooks/use-sites";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient(): EmporixClient {
  return new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
}

describe("prefetchEmporix", () => {
  it("defaults to an anonymous context and null site fields", async () => {
    const qc = new QueryClient();
    const client = makeClient();
    await prefetchEmporix(qc, {
      client,
      resource: "thing",
      args: ["t1"],
      site: "full",
      queryFn: () => Promise.resolve({ id: "t1" }),
    });
    expect(
      qc.getQueryData([
        "emporix",
        "thing",
        "t1",
        { tenant: "acme", authKind: "anonymous", siteCode: null, language: null },
      ]),
    ).toEqual({ id: "t1" });
  });

  it("keys authKind from the supplied auth context", async () => {
    const qc = new QueryClient();
    await prefetchEmporix(qc, {
      client: makeClient(),
      resource: "mine",
      args: [],
      site: "none",
      auth: auth.customer("cust"),
      queryFn: () => Promise.resolve(["x"]),
    });
    expect(qc.getQueryData(["emporix", "mine", { tenant: "acme", authKind: "customer" }])).toEqual([
      "x",
    ]);
  });

  it("'language' site carries only language; 'none' carries neither", async () => {
    const qc = new QueryClient();
    const client = makeClient();
    await prefetchEmporix(qc, {
      client,
      resource: "ling",
      args: [1],
      site: "language",
      language: "de",
      queryFn: () => Promise.resolve(1),
    });
    expect(
      qc.getQueryData([
        "emporix",
        "ling",
        1,
        { tenant: "acme", authKind: "anonymous", language: "de" },
      ]),
    ).toBe(1);

    await prefetchEmporix(qc, {
      client,
      resource: "bare",
      args: [],
      site: "none",
      siteCode: "main",
      language: "de",
      queryFn: () => Promise.resolve(2),
    });
    expect(qc.getQueryData(["emporix", "bare", { tenant: "acme", authKind: "anonymous" }])).toBe(2);
  });

  it("passes the resolved context to queryFn", async () => {
    let seen = "";
    await prefetchEmporix(new QueryClient(), {
      client: makeClient(),
      resource: "ctx",
      args: [],
      site: "none",
      auth: auth.customer("cust"),
      queryFn: (ctx) => {
        seen = ctx.kind;
        return Promise.resolve(null);
      },
    });
    expect(seen).toBe("customer");
  });

  it("produces a real hydration cache hit for a hook that bypasses useEmporixQuery", async () => {
    let hits = 0;
    server.use(
      http.get("https://api.emporix.io/site/acme/sites", () => {
        hits += 1;
        return HttpResponse.json([{ code: "main", name: "Main", default: true, active: true }]);
      }),
    );
    const client = makeClient();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });

    await prefetchEmporix(qc, {
      client,
      resource: "sites",
      args: [],
      site: "none",
      queryFn: (ctx) => client.sites.list(ctx),
    });
    expect(hits).toBe(1);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={qc}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useSites(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hits).toBe(1); // no refetch — the key matched
  });
});
