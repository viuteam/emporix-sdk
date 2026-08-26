import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { writeBundle } from "../src/write-bundle";

/**
 * The shared write path.
 *
 * Eleven mutation bundles route through this, so a mistake here is eleven bugs.
 * The three that matter: every listed key is invalidated, a thrown non-Error is
 * still an `Error` on the way out, and a failed write invalidates nothing —
 * re-fetching to learn that the server state did not change is a billed call for
 * an answer we already have.
 */
let qc: QueryClient;
let storage: EmporixStorage;

beforeEach(() => {
  qc = new QueryClient();
  storage = createMemoryStorage();
  TestBed.configureTestingModule({
    providers: [
      provideEmporix({
        client: { tenant: "acme", config: {} } as never,
        storage,
        queryClient: qc,
      }),
    ],
  });
});

describe("writeBundle", () => {
  it("invalidates every listed key on success", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const b = TestBed.runInInjectionContext(() =>
      writeBundle([
        ["emporix", "shopping-lists"],
        ["emporix", "cart"],
      ]),
    );
    await b.write(async () => "ok");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "shopping-lists"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "cart"] });
  });

  it("returns the work's value and leaves pending false", async () => {
    const b = TestBed.runInInjectionContext(() => writeBundle([["emporix", "x"]]));
    await expect(b.write(async () => ({ id: "l1" }))).resolves.toEqual({ id: "l1" });
    expect(b.isPending()).toBe(false);
    expect(b.error()).toBeNull();
  });

  it("normalizes a thrown non-Error and rethrows it", async () => {
    const b = TestBed.runInInjectionContext(() => writeBundle([["emporix", "x"]]));
    await expect(
      b.write(async () => {
        throw "a string, not an Error";
      }),
    ).rejects.toThrow("a string, not an Error");
    expect(b.error()).toBeInstanceOf(Error);
    expect(b.isPending()).toBe(false);
  });

  it("does not invalidate when the work throws", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const b = TestBed.runInInjectionContext(() => writeBundle([["emporix", "x"]]));
    await b
      .write(async () => {
        throw new Error("nope");
      })
      .catch(() => undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  it("clears a previous error on the next successful write", async () => {
    const b = TestBed.runInInjectionContext(() => writeBundle([["emporix", "x"]]));
    await b.write(async () => Promise.reject(new Error("first"))).catch(() => undefined);
    expect(b.error()?.message).toBe("first");
    await b.write(async () => "ok");
    expect(b.error()).toBeNull();
  });

  it("passes a customer context when a token is stored, anonymous otherwise", async () => {
    const b = TestBed.runInInjectionContext(() => writeBundle([["emporix", "x"]]));
    const guest = await b.write(async (ctx) => ctx.kind);
    expect(guest).toBe("anonymous");

    storage.setCustomerToken("t1");
    const signedIn = await b.write(async (ctx) => ctx.kind);
    expect(signedIn).toBe("customer");
  });
});
