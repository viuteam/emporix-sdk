import { describe, it, expect } from "vitest";
import { paginate, type Page } from "../src/core/context";

describe("paginate", () => {
  it("iterates pages until a short page is returned", async () => {
    const pages: Record<number, number[]> = { 0: [1, 2], 1: [3, 4], 2: [5] };
    const seen: number[] = [];
    const fetchPage = async (offset: number, limit: number): Promise<Page<number>> => {
      const items = pages[offset / limit] ?? [];
      return { items, total: 5, offset, limit };
    };
    for await (const n of paginate(fetchPage, 2)) seen.push(n);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops when total is reached even on a full last page", async () => {
    const fetchPage = async (offset: number, limit: number): Promise<Page<number>> => ({
      items: offset === 0 ? [1, 2] : [3, 4],
      total: 4,
      offset,
      limit,
    });
    const seen: number[] = [];
    for await (const n of paginate(fetchPage, 2)) seen.push(n);
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
