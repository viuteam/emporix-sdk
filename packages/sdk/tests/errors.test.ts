import { describe, it, expect } from "vitest";
import {
  EmporixError, EmporixAuthError, EmporixForbiddenError, EmporixNotFoundError,
  EmporixValidationError, EmporixServerError, errorFromResponse,
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
});
