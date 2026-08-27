import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useEmporix, useEmporixQuery } from "@viu/emporix-sdk-react";
import { auth, type EmporixClient } from "@viu/emporix-sdk";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * Label administration, wrapped for a Managed Dashboard module.
 *
 * These are not in `@viu/emporix-sdk-react` because a storefront token cannot
 * call them — the Label Service is back-office surface. The dashboard host passes
 * a customer token whose scopes reach it, which is what makes these twelve lines
 * possible at all.
 *
 * Every type is derived from the facade with `Parameters<…>` / `Awaited<…>`
 * rather than restated: under `exactOptionalPropertyTypes` a hand-written copy
 * diverges the moment the facade gains an optional field, and it diverges
 * silently.
 */
type LabelList = Awaited<ReturnType<EmporixClient["labels"]["listLabels"]>>;
type Label = Awaited<ReturnType<EmporixClient["labels"]["getLabel"]>>;
type LabelInput = Parameters<EmporixClient["labels"]["createLabel"]>[0];
type LabelUpdate = Parameters<EmporixClient["labels"]["updateLabel"]>[1];
type LabelQuery = Parameters<EmporixClient["labels"]["listLabels"]>[0];

/** 1 minute — labels change when a merchandiser changes them, not per render. */
const LABELS_STALE = 60_000;

/**
 * Labels for the tenant.
 *
 * `mode: "customer"` sends the host's token and, just as importantly, issues no
 * request without one — a module rendered before the host supplies `appState`
 * would otherwise 401 on first paint.
 *
 * `site: "none"` because labels are tenant-scoped. Keying by site would fragment
 * the cache and bill once per site for one answer.
 *
 * The `ctx` the factory hands us **must** be passed on: `listLabels` defaults its
 * `auth` parameter to a service context, which is client credentials with a
 * secret and does not exist in a browser.
 */
export function useLabels(query: LabelQuery = {}): UseQueryResult<LabelList> {
  const { client } = useEmporix();
  return useEmporixQuery<LabelList, readonly [LabelQuery]>({
    mode: "customer",
    site: "none",
    resource: "labels",
    args: [query],
    queryFn: (ctx) => client.labels.listLabels(query, ctx),
    staleTime: LABELS_STALE,
  });
}

/** One label by id. Disabled while the id is undefined or empty. */
export function useLabel(labelId: string | undefined): UseQueryResult<Label> {
  const { client } = useEmporix();
  return useEmporixQuery<Label, readonly [string | null]>({
    mode: "customer",
    site: "none",
    resource: "label",
    args: [labelId ?? null],
    enabled: typeof labelId === "string" && labelId !== "",
    queryFn: (ctx) => client.labels.getLabel(labelId as string, ctx),
    staleTime: LABELS_STALE,
  });
}

export interface LabelMutations {
  create: UseMutationResult<Label, unknown, LabelInput>;
  update: UseMutationResult<Label, unknown, { id: string; input: LabelUpdate }>;
  patch: UseMutationResult<Label, unknown, { id: string; patch: LabelUpdate }>;
  remove: UseMutationResult<void, unknown, string>;
}

/**
 * Label writes.
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
export function useLabelMutations(): LabelMutations {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();

  const ctx = (): ReturnType<typeof auth.customer> => {
    const token = storage.getCustomerToken();
    if (token === null) {
      throw new Error("label mutations require the dashboard host's token");
    }
    return auth.customer(token);
  };

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ["emporix", "labels"] });
    void qc.invalidateQueries({ queryKey: ["emporix", "label"] });
  };

  return {
    create: useMutation({
      mutationFn: (input: LabelInput) => client.labels.createLabel(input, ctx()),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: LabelUpdate }) =>
        client.labels.updateLabel(v.id, v.input, ctx()),
      onSuccess: invalidate,
    }),
    patch: useMutation({
      mutationFn: (v: { id: string; patch: LabelUpdate }) =>
        client.labels.patchLabel(v.id, v.patch, ctx()),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => client.labels.deleteLabel(id, ctx()),
      onSuccess: invalidate,
    }),
  };
}
