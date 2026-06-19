import { describe, it, expect } from "vitest";
import { hashSpec, readSpecVersion, diffManifest, type SyncManifest } from "../scripts/sync-manifest";

const entry = (sha256: string) => ({ url: "", specVersion: "", fetchedAt: "", sha256 });

describe("sync-manifest", () => {
  it("hashSpec is stable and content-sensitive", () => {
    expect(hashSpec("a")).toBe(hashSpec("a"));
    expect(hashSpec("a")).not.toBe(hashSpec("b"));
  });

  it("readSpecVersion reads info.version, '' when absent/empty", () => {
    expect(readSpecVersion("openapi: 3.0.0\ninfo:\n  title: X\n  version: v1\npaths:\n")).toBe("v1");
    expect(readSpecVersion("openapi: 3.0.0\ninfo:\n  title: X\n  version: ''\n")).toBe("");
    expect(readSpecVersion("openapi: 3.0.0\ninfo:\n  title: X\n")).toBe("");
  });

  it("diffManifest lists changed and new services, sorted", () => {
    const prev: SyncManifest = { generatedAt: "t0", services: { a: entry("1"), b: entry("x") } };
    const next: SyncManifest = { generatedAt: "t1", services: { a: entry("2"), b: entry("x"), c: entry("9") } };
    expect(diffManifest(prev, next)).toEqual(["a", "c"]);
  });

  it("diffManifest returns [] when there is no prior manifest", () => {
    expect(diffManifest(null, { generatedAt: "t", services: {} })).toEqual([]);
  });
});
