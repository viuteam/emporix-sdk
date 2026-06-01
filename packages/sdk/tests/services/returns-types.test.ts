import { describe, it, expectTypeOf } from "vitest";
import type {
  Return,
  ReturnList,
  ReturnInput,
  ReturnUpdate,
  ReturnPatch,
  ReturnCreated,
} from "../../src/services/returns-types";

describe("returns types", () => {
  it("types are usable; ReturnCreated exposes id; ReturnPatch is an op array", () => {
    expectTypeOf<Return>().not.toBeNever();
    expectTypeOf<ReturnList>().toBeArray();
    expectTypeOf<ReturnInput>().not.toBeNever();
    expectTypeOf<ReturnUpdate>().not.toBeNever();
    expectTypeOf<ReturnPatch>().toBeArray();
    const c = { id: "r1" } as ReturnCreated;
    expectTypeOf(c.id).toEqualTypeOf<string | undefined>();
  });
});
