/**
 * Moved to `@viu/emporix-sdk` (`core/browser-storage.ts`). The cookie name
 * mapping already lived there; the `document.cookie` half followed it so
 * `@viu/emporix-sdk-angular` reads and writes the exact same cookies. Two
 * backends drifting here would mean a session written by one binding and
 * unreadable by the other.
 */
export { createCookieStorage } from "@viu/emporix-sdk";
