/**
 * Moved to `@viu/emporix-sdk` (`core/session-storage.ts`). The whole
 * name-to-accessor mapping is framework-free, and the server side of it is what
 * `@viu/emporix-sdk-next` needed — keeping it here forced that package to depend
 * on the React bindings.
 *
 * Re-exported so the browser cookie backend (`./cookie`) keeps its import, with
 * only ONE definition of the mapping: a copy would be a cookie written under one
 * name and read under another.
 */
export { createCookieBackedStorage } from "@viu/emporix-sdk";
export type { CookieIo } from "@viu/emporix-sdk";
