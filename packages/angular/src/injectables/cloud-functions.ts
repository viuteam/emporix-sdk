import { signal, type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import type { EmporixClient } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { writeBundle } from "../write-bundle";

type InvokeOptions = Parameters<EmporixClient["cloudFunctions"]["invoke"]>[1];

export interface CloudFunctionOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: CloudFunctionOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * Invokes a cloud function as a read.
 *
 * A cloud function is opaque to this package: it may or may not be idempotent,
 * and nothing here can tell. Treating it as a read is a promise the *caller*
 * makes by choosing this over {@link injectCloudFunctions} — the default
 * `POST` will be retried on a refetch. Use the mutation for anything with an
 * effect.
 *
 * Unlike React's hook this takes no per-call `staleTime`; the `["emporix"]`
 * default of 30 s applies. Adding a knob is additive if one is ever needed.
 */
export function injectCloudFunction<TRes = unknown>(
  functionId: Signal<string>,
  options: Signal<InvokeOptions> = signal({}),
  opts: CloudFunctionOpts = {},
): CreateQueryResult<TRes> {
  const { client } = injectEmporix();
  return injectEmporixQuery<TRes, readonly [string, InvokeOptions]>(
    () => ({
      resource: "cloud-function",
      args: [functionId(), options()] as const,
      site: "none",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && functionId() !== "",
      queryFn: (ctx) => client.cloudFunctions.invoke<TRes>(functionId(), options(), ctx),
    }),
    pass(opts),
  );
}

export interface EmporixCloudFunctionMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  invoke<TRes = unknown>(vars: { functionId: string; options?: InvokeOptions }): Promise<TRes>;
}

/**
 * Invokes a cloud function as a write.
 *
 * Invalidates nothing. A cloud function's effects are opaque to this package, so
 * there is no key it could honestly claim went stale — invalidating `["emporix"]`
 * wholesale would refetch a storefront's entire cache on every call, and billing
 * is per request. Invalidate what you know changed from the call site.
 */
export function injectCloudFunctions(): EmporixCloudFunctionMutations {
  const { client } = injectEmporix();
  const b = writeBundle([]);
  return {
    isPending: b.isPending,
    error: b.error,
    invoke: <TRes = unknown>(vars: { functionId: string; options?: InvokeOptions }): Promise<TRes> =>
      b.write(
        (ctx) => client.cloudFunctions.invoke<TRes>(vars.functionId, vars.options ?? {}, ctx),
        `invokeCloudFunction(${vars.functionId})`,
      ),
  };
}
