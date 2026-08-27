import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createMemoryStorage } from "@viu/emporix-sdk-react";
import type { ReactNode } from "react";

const HOST = "https://api.emporix.io";

/**
 * A 403 carries the `missing scope:` hint the SDK turns into
 * `EmporixInsufficientScopeError`, so a test can assert the scope by name rather
 * than only the status.
 */
const scopeAware = (status: number): Response =>
  status === 403
    ? HttpResponse.json(
        { details: [{ message: "missing scope: brand.brand_manage" }] },
        { status: 403 },
      )
    : new HttpResponse(null, { status });
const TENANT = "acme";

/** One request per test, so a test can assert what actually went out. */
let requests: Request[] = [];
let failures: number[] = [];

export const server = setupServer(
  http.get(`${HOST}/brand/brands`, ({ request }) => {
    requests.push(request.clone());
    const status = failures.shift();
    if (status !== undefined) return scopeAware(status);
    return HttpResponse.json([{ id: "b1", name: "Acme" }]);
  }),
  http.post(`${HOST}/brand/brands`, ({ request }) => {
    requests.push(request.clone());
    const status = failures.shift();
    if (status !== undefined) return scopeAware(status);
    return HttpResponse.json({ id: "b2", name: "New" }, { status: 201 });
  }),
  http.get(`${HOST}/label/labels`, ({ request }) => {
    requests.push(request.clone());
    const status = failures.shift();
    if (status !== undefined) return scopeAware(status);
    return HttpResponse.json([{ id: "l1", name: "Sale" }]);
  }),
  http.post(`${HOST}/label/labels`, ({ request }) => {
    requests.push(request.clone());
    const status = failures.shift();
    if (status !== undefined) return scopeAware(status);
    return HttpResponse.json({ id: "l2", name: "New" }, { status: 201 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  requests = [];
  failures = [];
});
afterAll(() => server.close());

/** The last request the mock server saw, for asserting headers. */
export const lastRequest = (): Request | undefined => requests[requests.length - 1];
export const requestCount = (): number => requests.length;

/** Make the next matching request answer with `status` instead of a body. */
export const failNext = (status: number): void => {
  failures.push(status);
};

/**
 * The provider wired the way a dashboard module wires it.
 *
 * `customerSession="external"` and no `storage` prop: the host owns the token, so
 * the module must not write it into the dashboard's own `localStorage`. Retries
 * are off so a deliberate 403 fails once instead of three times.
 */
export function makeWrapper(opts: { token: string | null }): {
  wrapper: (props: { children: ReactNode }) => React.JSX.Element;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = new EmporixClient({ tenant: TENANT, credentials: {} });
  const storage = createMemoryStorage();
  if (opts.token !== null) storage.setCustomerToken(opts.token);

  const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
    <EmporixProvider
      client={client}
      queryClient={queryClient}
      storage={storage}
      customerSession="external"
      initialLanguage="en"
    >
      {children}
    </EmporixProvider>
  );
  return { wrapper, queryClient };
}
