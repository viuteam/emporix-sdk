import { describe, expect, it } from "vitest";
import * as hooks from "../src/hooks/index";
import * as pkg from "../src/index";
import type { UseOrderTransitionsOptions } from "../src/index";

/**
 * The package root lists its hooks by hand, so a hook added to `./hooks` can miss
 * it: `useOrderTransitions` shipped in 4.1.0 reachable only through the subpath,
 * while the README imports everything from the root.
 *
 * Types cannot be checked at runtime; the type import above is the check for the
 * one that was missing, and `pnpm typecheck` covers it.
 */
describe("package root", () => {
  it("exports every hook the ./hooks subpath does", () => {
    const missing = Object.keys(hooks).filter((name) => !(name in pkg));
    expect(missing).toEqual([]);
  });

  it("exports the options type of useOrderTransitions", () => {
    const options: UseOrderTransitionsOptions = {};
    expect(options).toEqual({});
  });
});
