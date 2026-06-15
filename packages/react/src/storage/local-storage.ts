import type { EmporixStorage } from "./index";
import { createMemoryStorage } from "./memory";
import { fromWebStorage } from "./web-storage";

/**
 * Browser `localStorage`-backed store: persistent and shared across tabs.
 * Falls back to memory on the server (or when localStorage is unavailable).
 */
export function createLocalStorage(opts: { key?: string } = {}): EmporixStorage {
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] localStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  return fromWebStorage((globalThis as unknown as { localStorage: Storage }).localStorage, opts);
}

/** @deprecated Use {@link createLocalStorage}. Kept for backward compatibility. */
export const createLocalStorageStorage = createLocalStorage;
