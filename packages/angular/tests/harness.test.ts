import { describe, expect, it } from "vitest";
import { ApplicationRef, InjectionToken, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";

const PROBE = new InjectionToken<string>("PROBE");

/**
 * The harness itself is under test here, not the product. Every later test in
 * this package leans on TestBed being able to (a) resolve a token and (b) hand
 * out a real ApplicationRef — the second is what makes TanStack's internal
 * `effect()` flush. Without this test, a broken harness would surface as
 * queries that never resolve, which reads like a product bug.
 */
describe("Angular test harness", () => {
  it("resolves a token through runInInjectionContext", () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PROBE, useValue: "ok" }],
    });
    const value = TestBed.runInInjectionContext(() => inject(PROBE));
    expect(value).toBe("ok");
  });

  it("provides an ApplicationRef, which is what lets effects flush", () => {
    TestBed.configureTestingModule({ providers: [] });
    expect(TestBed.inject(ApplicationRef)).toBeDefined();
  });
});
