/**
 * Moved to `@viu/emporix-sdk` (`core/customer-session-store.ts`) — a
 * subscribe/snapshot store over `EmporixStorage` is not a React concern, and
 * `@viu/emporix-sdk-angular` needs the same one. Re-exported so existing imports
 * keep working; there is exactly one definition.
 */
export { getCustomerSessionStore } from "@viu/emporix-sdk";
export type { CustomerSessionState, CustomerSessionStore } from "@viu/emporix-sdk";
