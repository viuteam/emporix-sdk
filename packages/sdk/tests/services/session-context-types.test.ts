import { describe, it, expectTypeOf } from "vitest";
import type {
  SessionContext,
  SessionContextPatch,
  SessionContextData,
} from "../../src/services/session-context-types";

describe("session-context types", () => {
  it("keeps sessionId required and a flat version patch", () => {
    expectTypeOf<SessionContext>().not.toBeNever();
    expectTypeOf<SessionContext["sessionId"]>().toEqualTypeOf<string>();
    expectTypeOf<SessionContextData>().not.toBeNever();
    // flat convenience version, resolved to metadata.version by the service
    expectTypeOf<SessionContextPatch["version"]>().toEqualTypeOf<number | undefined>();
    // a bare patch (no metadata) is valid input
    expectTypeOf<{ siteCode: string }>().toMatchTypeOf<SessionContextPatch>();
  });
});
