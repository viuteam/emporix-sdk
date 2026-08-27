/**
 * Moved to `@viu/emporix-sdk` (`core/browser-storage.ts`) — `localStorage` is
 * not a React API, and `@viu/emporix-sdk-angular` needs the same backend.
 * Re-exported: both names have always been part of this package's public surface.
 */
export { createLocalStorage, createLocalStorageStorage } from "@viu/emporix-sdk";
