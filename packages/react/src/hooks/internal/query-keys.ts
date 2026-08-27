/**
 * Moved to `@viu/emporix-sdk` (`core/query-keys.ts`): the key shape has to be
 * identical across framework bindings, so it cannot live in one of them. This
 * re-export keeps every existing import in this package working, and there is
 * deliberately only ONE definition — see `tests/agnostic-single-source.test.ts`,
 * which asserts identity rather than deep equality precisely because a
 * duplicated builder would pass a `toEqual` check and then drift.
 */
export { emporixKey, siteMeta } from "@viu/emporix-sdk";
export type { SiteFields } from "@viu/emporix-sdk";
