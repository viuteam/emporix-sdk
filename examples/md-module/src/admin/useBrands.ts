import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useEmporix, useEmporixQuery } from "@viu/emporix-sdk-react";
import { auth, type EmporixClient } from "@viu/emporix-sdk";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * Brand administration, wrapped for a Managed Dashboard module.
 *
 * These are not in `@viu/emporix-sdk-react` because a storefront token cannot
 * call them — the Brand Service is back-office surface. The dashboard host passes
 * a customer token whose scopes reach it, which is what makes these twelve lines
 * possible at all.
 *
 * Every type is derived from the facade with `Parameters<…>` / `Awaited<…>`
 * rather than restated: under `exactOptionalPropertyTypes` a hand-written copy
 * diverges the moment the facade gains an optional field, and it diverges
 * silently.
 */
type BrandList = Awaited<ReturnType<EmporixClient["brands"]["listBrands"]>>;
type Brand = Awaited<ReturnType<EmporixClient["brands"]["getBrand"]>>;
type BrandInput = Parameters<EmporixClient["brands"]["createBrand"]>[0];
type BrandUpdate = Parameters<EmporixClient["brands"]["updateBrand"]>[1];
type BrandQuery = Parameters<EmporixClient["brands"]["listBrands"]>[0];

/** 1 minute — brands change when a merchandiser changes them, not per render. */
const BRANDS_STALE = 60_000;

/**
 * Brands for the tenant.
 *
 * `mode: "customer"` sends the host's token and, just as importantly, issues no
 * request without one — a module rendered before the host supplies `appState`
 * would otherwise 401 on first paint.
 *
 * `site: "none"` because brands are tenant-scoped. Keying by site would fragment
 * the cache and bill once per site for one answer.
 *
 * The `ctx` the factory hands us **must** be passed on: `listBrands` defaults its
 * `auth` parameter to a service context, which is client credentials with a
 * secret and does not exist in a browser.
 */
export function useBrands(query: BrandQuery = {}): UseQueryResult<BrandList> {
  const { client } = useEmporix();
  return useEmporixQuery<BrandList, readonly [BrandQuery]>({
    mode: "customer",
    site: "none",
    resource: "brands",
    args: [query],
    queryFn: (ctx) => client.brands.listBrands(query, ctx),
    staleTime: BRANDS_STALE,
  });
}

/** One brand by id. Disabled while the id is undefined or empty. */
export function useBrand(brandId: string | undefined): UseQueryResult<Brand> {
  const { client } = useEmporix();
  return useEmporixQuery<Brand, readonly [string | null]>({
    mode: "customer",
    site: "none",
    resource: "brand",
    args: [brandId ?? null],
    enabled: typeof brandId === "string" && brandId !== "",
    queryFn: (ctx) => client.brands.getBrand(brandId as string, ctx),
    staleTime: BRANDS_STALE,
  });
}

export interface BrandMutations {
  create: UseMutationResult<Brand, unknown, BrandInput>;
  update: UseMutationResult<Brand, unknown, { id: string; input: BrandUpdate }>;
  patch: UseMutationResult<Brand, unknown, { id: string; patch: BrandUpdate }>;
  remove: UseMutationResult<void, unknown, string>;
}

/**
 * Brand writes.
 *
 * Plain `useMutation`: `@viu/emporix-sdk-react` has no write-side factory, so the
 * invalidation is explicit. It runs `onSuccess` only — a failed write left the
 * server state alone, and refetching to establish that is a billed call for an
 * answer we already have.
 *
 * The auth context is resolved **per call**, not once per render: a mutation
 * object outlives the render that created it, and the dashboard host rotates the
 * token underneath it.
 */
export function useBrandMutations(): BrandMutations {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();

  const ctx = (): ReturnType<typeof auth.customer> => {
    const token = storage.getCustomerToken();
    if (token === null) {
      throw new Error("brand mutations require the dashboard host's token");
    }
    return auth.customer(token);
  };

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ["emporix", "brands"] });
    void qc.invalidateQueries({ queryKey: ["emporix", "brand"] });
  };

  return {
    create: useMutation({
      mutationFn: (input: BrandInput) => client.brands.createBrand(input, ctx()),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: BrandUpdate }) =>
        client.brands.updateBrand(v.id, v.input, ctx()),
      onSuccess: invalidate,
    }),
    patch: useMutation({
      mutationFn: (v: { id: string; patch: BrandUpdate }) =>
        client.brands.patchBrand(v.id, v.patch, ctx()),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => client.brands.deleteBrand(id, ctx()),
      onSuccess: invalidate,
    }),
  };
}
