import type { EmporixStorage } from "./index";
import { createMemoryStorage } from "./memory";
import { fromWebStorage } from "./web-storage";

/**
 * Browser `sessionStorage`-backed store: per-tab persistence that survives a
 * reload but is cleared when the tab closes and is not shared across tabs.
 * Falls back to memory on the server (or when sessionStorage is unavailable).
 */
export function createSessionStorage(opts: { key?: string } = {}): EmporixStorage {
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { sessionStorage?: Storage }).sessionStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] sessionStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  return fromWebStorage((globalThis as unknown as { sessionStorage: Storage }).sessionStorage, opts);
}
