import { describe, it, expectTypeOf } from "vitest";
import type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
  ApprovalPermittedInput,
  ApprovalPermittedResult,
  ApprovalUsersQuery,
  ApprovalUsersResult,
} from "../../src/services/approval-types";

describe("approval-types", () => {
  it("aliases the read/list shapes", () => {
    expectTypeOf<ApprovalList>().toEqualTypeOf<Approval[]>();
    expectTypeOf<Approval>().toHaveProperty("id");
    expectTypeOf<Approval>().toHaveProperty("status");
  });

  it("create body is a cart-or-quote union and returns an id", () => {
    expectTypeOf<ApprovalCreated>().toHaveProperty("id");
    expectTypeOf<ApprovalInput>().not.toBeNever();
  });

  it("patch is an op-array; permitted/users shapes resolve", () => {
    expectTypeOf<ApprovalPatch>().toBeArray();
    expectTypeOf<ApprovalPermittedResult>().toHaveProperty("permitted");
    expectTypeOf<ApprovalUsersResult>().toBeArray();
    expectTypeOf<ApprovalPermittedInput>().not.toBeNever();
    expectTypeOf<ApprovalUsersQuery>().not.toBeNever();
  });
});
