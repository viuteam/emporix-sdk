import { type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import type { EmporixClient } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { writeBundle } from "../write-bundle";

type ReturnList = Awaited<ReturnType<EmporixClient["returns"]["listReturns"]>>;
type ReturnResult = Awaited<ReturnType<EmporixClient["returns"]["getReturn"]>>;
type ReturnQuery = Parameters<EmporixClient["returns"]["listReturns"]>[0];
type ReturnInput = Parameters<EmporixClient["returns"]["createReturn"]>[0];
type ReturnCreated = Awaited<ReturnType<EmporixClient["returns"]["createReturn"]>>;

/** 30 seconds — an RMA's status changes on the merchant's side. */
const RETURNS_STALE = 30_000;

export interface ReturnsOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: ReturnsOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * The signed-in customer's returns.
 *
 * `mode: "customer"` is what makes this a self-service read: the facade defaults
 * to a service context, because the Returns Service is primarily a back-office
 * API, and the customer's own returns are the subset a customer token can see.
 */
export function injectMyReturns(
  query: Signal<ReturnQuery>,
  opts: ReturnsOpts = {},
): CreateQueryResult<ReturnList> {
  const { client } = injectEmporix();
  return injectEmporixQuery<ReturnList, readonly [ReturnQuery]>(
    () => ({
      resource: "returns",
      args: [query()] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.returns.listReturns(query(), ctx),
      staleTime: RETURNS_STALE,
    }),
    pass(opts),
  );
}

/** One return by id. Disabled while the id is empty. */
export function injectReturn(
  returnId: Signal<string>,
  opts: ReturnsOpts = {},
): CreateQueryResult<ReturnResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<ReturnResult, readonly [string]>(
    () => ({
      resource: "return",
      args: [returnId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && returnId() !== "",
      queryFn: (ctx) => client.returns.getReturn(returnId(), ctx),
      staleTime: RETURNS_STALE,
    }),
    pass(opts),
  );
}

export interface EmporixReturnMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  /** Files a return. Invalidates the list so the new RMA appears. */
  create(input: ReturnInput): Promise<ReturnCreated>;
}

export function injectReturnMutations(): EmporixReturnMutations {
  const { client } = injectEmporix();
  const b = writeBundle(
    [
      ["emporix", "returns"],
      ["emporix", "return"],
    ],
    { customerOnly: true },
  );
  return {
    isPending: b.isPending,
    error: b.error,
    create: (input) => b.write((ctx) => client.returns.createReturn(input, ctx), "createReturn"),
  };
}
