import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useEmporixTelemetry,
  type EmporixTelemetryEvent,
} from "../src/telemetry";
import type { ReactNode } from "react";

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

function makeClient() {
  return new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf" },
    },
    logger: false,
  });
}

function wrap(opts: { onTelemetry?: (e: EmporixTelemetryEvent) => void } = {}) {
  const client = makeClient();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={createMemoryStorage()}
      queryClient={queryClient}
      {...(opts.onTelemetry ? { onTelemetry: opts.onTelemetry } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("Telemetry — cache events", () => {
  it("emits cache.miss with non-negative durationMs on first fetch", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["emporix", "telemetry-test-1"],
          queryFn: () => Promise.resolve({ ok: true }),
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const miss = events.find((e) => e.type === "cache.miss");
    expect(miss).toBeDefined();
    expect((miss as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits query.error when the queryFn rejects", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    renderHook(
      () =>
        useQuery({
          queryKey: ["emporix", "telemetry-boom"],
          queryFn: () => Promise.reject(new Error("nope")),
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(events.some((e) => e.type === "query.error")).toBe(true),
    );
  });

  it("filters non-emporix queryKeys (consumer keys are ignored)", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    renderHook(
      () =>
        useQuery({
          queryKey: ["app", "user-prefs"],
          queryFn: () => Promise.resolve({ theme: "dark" }),
        }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 10));
    const cacheMisses = events.filter((e) => e.type === "cache.miss");
    expect(cacheMisses).toEqual([]);
  });
});

describe("Telemetry — mutation events", () => {
  it("emits mutation.success with durationMs", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(
      () =>
        useMutation({
          mutationKey: ["emporix", "test-mutation"],
          mutationFn: async () => "ok",
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => {
      const success = events.find((e) => e.type === "mutation.success");
      expect(success).toBeDefined();
    });
  });

  it("emits mutation.error when the mutation rejects", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(
      () =>
        useMutation({
          mutationKey: ["emporix", "bad-mutation"],
          mutationFn: async () => {
            throw new Error("denied");
          },
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => {
      const err = events.find((e) => e.type === "mutation.error");
      expect(err).toBeDefined();
    });
  });
});

describe("Telemetry — storage events", () => {
  it("emits storage.write for cartId + siteCode", async () => {
    const storage = createMemoryStorage();
    const events: EmporixTelemetryEvent[] = [];
    const client = makeClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <EmporixProvider
        client={client}
        storage={storage}
        queryClient={queryClient}
        onTelemetry={(e) => events.push(e)}
      >
        <div />
      </EmporixProvider>,
    );
    storage.setCartId("c1");
    storage.setSiteCode("X");
    const writes = events.filter((e) => e.type === "storage.write");
    expect(writes.map((e) => (e as { key: string }).key)).toEqual([
      "cartId",
      "siteCode",
    ]);
  });
});

describe("Telemetry — custom events via useEmporixTelemetry", () => {
  it("custom emit reaches onTelemetry", () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(() => useEmporixTelemetry(), { wrapper });
    act(() => {
      result.current.emit({ type: "custom", name: "app.test" });
    });
    expect(events).toContainEqual({ type: "custom", name: "app.test" });
  });

  it("emit is no-op when no onTelemetry is configured (no throw)", () => {
    const wrapper = wrap();
    const { result } = renderHook(() => useEmporixTelemetry(), { wrapper });
    expect(() => result.current.emit({ type: "custom", name: "x" })).not.toThrow();
  });

  it("useEmporixTelemetry throws when used outside EmporixProvider", () => {
    expect(() => renderHook(() => useEmporixTelemetry())).toThrow(/EmporixProvider/);
  });

  it("handler that throws does not break the provider", () => {
    const wrapper = wrap({
      onTelemetry: () => {
        throw new Error("handler broken");
      },
    });
    const { result } = renderHook(() => useEmporixTelemetry(), { wrapper });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => result.current.emit({ type: "custom", name: "x" })).not.toThrow();
    errorSpy.mockRestore();
  });
});
