import { describe, it, expect } from "vitest";
import {
  EmporixError, EmporixAuthError, EmporixForbiddenError, EmporixNotFoundError,
  EmporixValidationError, EmporixServerError, EmporixInsufficientScopeError, errorFromResponse,
} from "../src/core/errors";

describe("errors", () => {
  it("all subclasses extend EmporixError and carry status", () => {
    const e = new EmporixAuthError("nope", 401, { foo: "bar" });
    expect(e).toBeInstanceOf(EmporixError);
    expect(e.status).toBe(401);
    expect(e.body).toEqual({ foo: "bar" });
    expect(e.name).toBe("EmporixAuthError");
  });

  it("errorFromResponse maps status codes to subclasses", () => {
    expect(errorFromResponse(401, "a", {})).toBeInstanceOf(EmporixAuthError);
    expect(errorFromResponse(403, "a", {})).toBeInstanceOf(EmporixForbiddenError);
    expect(errorFromResponse(404, "a", {})).toBeInstanceOf(EmporixNotFoundError);
    expect(errorFromResponse(400, "a", {})).toBeInstanceOf(EmporixValidationError);
    expect(errorFromResponse(422, "a", {})).toBeInstanceOf(EmporixValidationError);
    expect(errorFromResponse(500, "a", {})).toBeInstanceOf(EmporixServerError);
    expect(errorFromResponse(418, "a", {})).toBeInstanceOf(EmporixError);
  });

  it("never serialises token-like fields in body via toJSON", () => {
    const e = new EmporixAuthError("x", 401, { access_token: "SECRET", ok: 1 });
    expect(JSON.stringify(e)).not.toContain("SECRET");
    expect(JSON.stringify(e)).toContain('"ok":1');
  });

  it("EmporixInsufficientScopeError subclasses ForbiddenError and carries requiredScope", () => {
    const e = new EmporixInsufficientScopeError(
      "nope",
      403,
      { details: ["missing scope: customermanagement.legalentity_manage"] },
      "customermanagement.legalentity_manage",
    );
    expect(e).toBeInstanceOf(EmporixForbiddenError);
    expect(e.status).toBe(403);
    expect(e.requiredScope).toBe("customermanagement.legalentity_manage");
  });

  it("errorFromResponse maps 403 with a scope hint in details to InsufficientScopeError", () => {
    const e = errorFromResponse(403, "GET /x → 403", {
      details: ["missing scope: customermanagement.legalentity_manage"],
    });
    expect(e).toBeInstanceOf(EmporixInsufficientScopeError);
    expect((e as EmporixInsufficientScopeError).requiredScope).toBe(
      "customermanagement.legalentity_manage",
    );
  });

  it("errorFromResponse keeps plain ForbiddenError when 403 has no scope hint", () => {
    const e = errorFromResponse(403, "GET /x → 403", { details: ["something else"] });
    expect(e).toBeInstanceOf(EmporixForbiddenError);
    expect(e).not.toBeInstanceOf(EmporixInsufficientScopeError);
  });
});
