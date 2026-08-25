---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": patch
---

feat(sdk): move the query-key builder, customer-session store and browser storage backends into the core SDK

`emporixKey`, `siteMeta`, `getCustomerSessionStore`, `createListenerSet` and the
browser storage backends (`createMemoryStorage`, `createLocalStorage`,
`createSessionStorage`, `createCookieStorage`, `fromWebStorage`) are now defined
in `@viu/emporix-sdk` and re-exported from `@viu/emporix-sdk-react`.

**No breaking change and no behaviour change.** Every existing import keeps
working, and each moved symbol is the same object through both paths — asserted
by identity, not deep equality, in `tests/agnostic-single-source.test.ts`,
because a duplicated implementation would pass a `toEqual` check and then drift.
The React suite passes unchanged: every file it touched became a re-export of
the same object.

This is the third instance of a move this repo has already made twice, for the
same reason: `STORAGE_KEYS` and `EmporixStorage` went down so
`@viu/emporix-sdk-next` could stop depending on the React bindings. These go
down so an Angular binding can do the same. A cache-key builder duplicated per
framework agrees on the day it is written and splits every cache entry in half
thereafter.

**The SDK stays DOM-free at the type level.** It compiles with `lib: ["ES2022"]`
and no `"DOM"`, which is what keeps it runnable on Node, edge runtimes and
workers. Rather than switch that guard off for all ~60 services to satisfy one
file, `core/browser-storage.ts` reaches `localStorage`, `sessionStorage`,
`document` and `location` through a narrowed `globalThis` — the pattern the
localStorage availability check already used before the move.

`scripts/check-treeshake.mjs` now also probes for `localStorage` and
`document.cookie`, so a Node or edge consumer that never imports a browser
backend provably does not pay for one. A `createEmporixClient`-only bundle is
29.1 KB, unchanged by this move.
