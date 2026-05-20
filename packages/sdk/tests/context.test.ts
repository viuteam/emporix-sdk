import { describe, it, expect } from "vitest";
import { iterateAll, type PaginatedItems } from "../src/core/context";

describe("iterateAll", () => {
  it("yields every item across pages and stops on hasNextPage=false", async () => {
    const pages: PaginatedItems<number>[] = [
      { items: [1, 2], pageNumber: 1, pageSize: 2, hasNextPage: true },
      { items: [3, 4], pageNumber: 2, pageSize: 2, hasNextPage: true },
      { items: [5], pageNumber: 3, pageSize: 2, hasNextPage: false },
    ];
    const calls: number[] = [];
    const fetch = (p: number) => {
      calls.push(p);
      const page = pages[p - 1];
      if (!page) throw new Error(`unexpected page ${p}`);
      return Promise.resolve(page);
    };
    const out: number[] = [];
    for await (const n of iterateAll<number>(fetch)) out.push(n);
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual([1, 2, 3]);
  });

  it("respects a custom start page", async () => {
    const fetch = (p: number) =>
      Promise.resolve<PaginatedItems<string>>({
        items: [`p${p}`],
        pageNumber: p,
        pageSize: 1,
        hasNextPage: false,
      });
    const out: string[] = [];
    for await (const s of iterateAll<string>(fetch, 5)) out.push(s);
    expect(out).toEqual(["p5"]);
  });
});

