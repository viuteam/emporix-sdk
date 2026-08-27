import { type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import type { EmporixClient } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { writeBundle } from "../write-bundle";

type ApprovalList = Awaited<ReturnType<EmporixClient["approvals"]["listApprovals"]>>;
type ApprovalResult = Awaited<ReturnType<EmporixClient["approvals"]["getApproval"]>>;
type ApprovalQuery = Parameters<EmporixClient["approvals"]["listApprovals"]>[0];
type ApprovalInput = Parameters<EmporixClient["approvals"]["createApproval"]>[0];
type ApprovalCreated = Awaited<ReturnType<EmporixClient["approvals"]["createApproval"]>>;
type ApprovalPatch = Parameters<EmporixClient["approvals"]["updateApproval"]>[1];

/** 30 seconds — an approval's state changes on someone else's action. */
const APPROVALS_STALE = 30_000;

export interface ApprovalOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: ApprovalOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * Approvals visible to the signed-in customer.
 *
 * `mode: "customer"`, like every other read here whose facade defaults to a
 * service context: approvals are a B2B workflow API, and the requester's own
 * approvals are the subset a customer token can see.
 */
export function injectApprovals(
  query: Signal<ApprovalQuery>,
  opts: ApprovalOpts = {},
): CreateQueryResult<ApprovalList> {
  const { client } = injectEmporix();
  return injectEmporixQuery<ApprovalList, readonly [ApprovalQuery]>(
    () => ({
      resource: "approvals",
      args: [query()] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.approvals.listApprovals(query(), ctx),
      staleTime: APPROVALS_STALE,
    }),
    pass(opts),
  );
}

/** One approval by id. Disabled while the id is empty. */
export function injectApproval(
  approvalId: Signal<string>,
  opts: ApprovalOpts = {},
): CreateQueryResult<ApprovalResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<ApprovalResult, readonly [string]>(
    () => ({
      resource: "approval",
      args: [approvalId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && approvalId() !== "",
      queryFn: (ctx) => client.approvals.getApproval(approvalId(), ctx),
      staleTime: APPROVALS_STALE,
    }),
    pass(opts),
  );
}

export interface EmporixApprovalMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  create(input: ApprovalInput): Promise<ApprovalCreated>;
  /** Applies a patch — typically the decision. The server enforces who may. */
  update(vars: { approvalId: string; ops: ApprovalPatch }): Promise<void>;
}

export function injectApprovalMutations(): EmporixApprovalMutations {
  const { client } = injectEmporix();
  const b = writeBundle(
    [
      ["emporix", "approvals"],
      ["emporix", "approval"],
    ],
    { customerOnly: true },
  );
  return {
    isPending: b.isPending,
    error: b.error,
    create: (input) =>
      b.write((ctx) => client.approvals.createApproval(input, ctx), "createApproval"),
    update: (v) =>
      b.write(
        (ctx) => client.approvals.updateApproval(v.approvalId, v.ops, ctx),
        "updateApproval",
      ),
  };
}
