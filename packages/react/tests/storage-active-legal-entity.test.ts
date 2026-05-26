import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "../src/storage/memory";
import type { EmporixStorageKey } from "../src/storage";

describe("EmporixStorage.activeLegalEntityId helpers", () => {
  it("get/set/clear roundtrip in memory backend", () => {
    const s = createMemoryStorage();
    expect(s.getActiveLegalEntityId()).toBeNull();
    s.setActiveLegalEntityId("le-1");
    expect(s.getActiveLegalEntityId()).toBe("le-1");
    s.setActiveLegalEntityId(null);
    expect(s.getActiveLegalEntityId()).toBeNull();
  });

  it("notifies subscribers via subscribeAll", () => {
    const s = createMemoryStorage();
    const seen: EmporixStorageKey[] = [];
    s.subscribeAll?.((key) => seen.push(key));
    s.setActiveLegalEntityId("le-2");
    expect(seen).toContain("activeLegalEntityId");
    seen.length = 0;
    s.setActiveLegalEntityId(null);
    expect(seen).toContain("activeLegalEntityId");
  });
});
