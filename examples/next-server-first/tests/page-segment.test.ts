import { describe, expect, it } from "vitest";
import { MAX_PAGE, parsePageSegment } from "../app/lib/page-segment";

describe("parsePageSegment", () => {
  it("treats a missing segment as page one", () => {
    expect(parsePageSegment(undefined)).toEqual({ kind: "page", page: 1 });
    expect(parsePageSegment([])).toEqual({ kind: "page", page: 1 });
  });

  it("calls an explicit 1 an alias of the bare URL", () => {
    // `/de/category/x/1` renders exactly what `/de/category/x` renders. It is a URL a
    // human would type, so it redirects rather than 404s.
    expect(parsePageSegment(["1"])).toEqual({ kind: "alias" });
  });

  it("accepts a real page number", () => {
    expect(parsePageSegment(["2"])).toEqual({ kind: "page", page: 2 });
    expect(parsePageSegment(["10"])).toEqual({ kind: "page", page: 10 });
    expect(parsePageSegment([String(MAX_PAGE)])).toEqual({ kind: "page", page: MAX_PAGE });
  });

  it("rejects everything that is not a page number", () => {
    // Measured 2026-08-06: every one of these answered 200 before.
    expect(parsePageSegment(["0"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["-1"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["01"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["abc"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1.5"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1e3"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment([""])).toEqual({ kind: "invalid" });
    expect(parsePageSegment([" 2"])).toEqual({ kind: "invalid" });
  });

  it("rejects more than one segment", () => {
    // `/de/category/x/2/3/4` used to render page 2 and claim page 2's canonical.
    expect(parsePageSegment(["2", "3", "4"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1", "1"])).toEqual({ kind: "invalid" });
  });

  it("rejects a page number Emporix would reject", () => {
    // Measured: pageNumber 99'999 answers 200 with an empty list, 1e15 and above answer
    // 400 — which would surface as a 500. The bound keeps that unreachable.
    expect(parsePageSegment([String(MAX_PAGE + 1)])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1000000000000000"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment([String(Number.MAX_SAFE_INTEGER)])).toEqual({ kind: "invalid" });
  });
});
