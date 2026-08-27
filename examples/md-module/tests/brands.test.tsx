import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBrandMutations, useBrands } from "../src/admin/useBrands";
import { EmporixForbiddenError } from "@viu/emporix-sdk";
import { failNext, lastRequest, makeWrapper, requestCount } from "./support";

describe("useBrands", () => {
  /**
   * A module rendered before the host supplies `appState` has no token. It must
   * sit idle rather than 401 on first paint — that is what `mode: "customer"`
   * buys, and it is the difference from a hand-rolled `useQuery`.
   */
  it("issues no request without a token, and does not error", async () => {
    const { wrapper } = makeWrapper({ token: null });
    const { result } = renderHook(() => useBrands(), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(requestCount()).toBe(0);
    expect(result.current.isError).toBe(false);
  });

  it("sends the host token as a bearer and returns the list", async () => {
    const { wrapper } = makeWrapper({ token: "host-token" });
    const { result } = renderHook(() => useBrands({ pageSize: 20 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "b1", name: "Acme" }]);
    expect(lastRequest()?.headers.get("authorization")).toBe("Bearer host-token");
  });

  /**
   * The key must sit under `["emporix", …]`, or it drops out of the provider's
   * query defaults and out of `["emporix"]`-scoped invalidation — silently. This
   * is the whole reason the hook goes through the factory instead of `useQuery`.
   */
  it("keys under the emporix namespace", async () => {
    const { wrapper, queryClient } = makeWrapper({ token: "host-token" });
    const { result } = renderHook(() => useBrands(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const key = queryClient.getQueryCache().getAll()[0]?.queryKey ?? [];
    expect(key[0]).toBe("emporix");
    expect(key[1]).toBe("brands");
  });

  /** Tenant-scoped: no siteCode or language in the key, so one entry serves every site. */
  it("carries no site discriminators", async () => {
    const { wrapper, queryClient } = makeWrapper({ token: "host-token" });
    const { result } = renderHook(() => useBrands(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const key = queryClient.getQueryCache().getAll()[0]?.queryKey ?? [];
    const meta = key[key.length - 1] as Record<string, unknown>;
    expect("siteCode" in meta).toBe(false);
    expect("language" in meta).toBe(false);
  });
});

describe("useBrandMutations", () => {
  it("invalidates the list after a create, so the table refreshes itself", async () => {
    const { wrapper, queryClient } = makeWrapper({ token: "host-token" });
    const { result } = renderHook(
      () => ({ list: useBrands(), m: useBrandMutations() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await result.current.m.create.mutateAsync({ name: "Acme" } as never);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "brands"] });
  });

  it("does not invalidate when the write fails", async () => {
    const { wrapper, queryClient } = makeWrapper({ token: "host-token" });
    const { result } = renderHook(() => useBrandMutations(), { wrapper });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    failNext(409);
    await expect(result.current.create.mutateAsync({} as never)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  /**
   * The expected answer when the module runs on a token without the scope — a
   * storefront token, or a dashboard user whose role was never granted it. It has
   * to surface as an error the UI can name, not be swallowed.
   *
   * Asserts `EmporixForbiddenError`, the class the UI branches on, and not the
   * `EmporixInsufficientScopeError` subclass: that one needs a `missing scope:`
   * hint in the body, and whether the tenant actually sends one is a question for
   * the live run — asserting it here would only test the mock body this file
   * invented.
   */
  it("surfaces a scope failure as a forbidden error", async () => {
    const { wrapper } = makeWrapper({ token: "storefront-token" });
    const { result } = renderHook(() => useBrandMutations(), { wrapper });
    failNext(403);
    await expect(result.current.create.mutateAsync({} as never)).rejects.toBeInstanceOf(EmporixForbiddenError);
  });

  it("refuses to write without a token instead of sending an anonymous request", async () => {
    const { wrapper } = makeWrapper({ token: null });
    const { result } = renderHook(() => useBrandMutations(), { wrapper });
    await expect(result.current.create.mutateAsync({} as never)).rejects.toThrow(
      /host's token/,
    );
    expect(requestCount()).toBe(0);
  });
});
