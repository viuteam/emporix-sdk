import { describe, expect, it } from "vitest";
import { stripHtml } from "@viu/emporix-examples-shared";

/**
 * `stripHtml` lives in `examples/shared`, which has no test setup of its own. It is
 * tested from here rather than by scaffolding vitest a second time.
 *
 * CodeQL flagged the original `<[^>]*>` as `js/polynomial-redos` — high severity —
 * and it was right: a run of `<` with no closing `>` made the engine rescan the
 * tail from every `<`.
 */
describe("stripHtml", () => {
  it("strips tags and collapses whitespace", () => {
    expect(stripHtml("<b>Beantragung</b><div><br></div>Rollen &nbsp;und <i>x</i>")).toBe(
      "Beantragung Rollen und x",
    );
  });

  it("does not backtrack quadratically over unclosed tags", () => {
    // 145ms with `[^>]` at 20k, 556ms at 40k, 2198ms at 80k. The bound is loose on
    // purpose — it has to fail on the quadratic version and pass on a busy CI box,
    // and those two are three orders of magnitude apart.
    const evil = "<".repeat(80_000);
    const started = performance.now();
    expect(stripHtml(evil)).toBe(evil);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
