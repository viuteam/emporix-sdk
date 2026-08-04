---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": patch
"@viu/emporix-sdk-next": minor
---

`@viu/emporix-sdk-next` no longer depends on `@viu/emporix-sdk-react`. The peer
dependency is gone, and the built package contains zero imports of it.

A server-first Next app therefore installs **three** packages instead of four,
and with them no React and no `@tanstack/react-query` — both are peers of the
React bindings, and neither has anything to do with a mode where the browser makes
no Emporix calls at all.

What moved to `@viu/emporix-sdk` (`core/session-storage.ts`), completing the step
that started with `STORAGE_KEYS`:

| Export | Was |
|---|---|
| `EmporixStorage`, `TokenStorage`, `PersistedAnonymousSession` | the session-persistence contract |
| `parseAnonymousSession` | parses a stored anonymous session |
| `createCookieBackedStorage`, `CookieIo` | the whole key-to-accessor mapping |
| `createServerStorage`, `ServerCookieJar` | an `EmporixStorage` over any cookie jar |
| `serverAuth` | customer context when a token is stored, else anonymous |

None of it imports React — `createServerStorage` fits Next, Remix, SvelteKit,
Nitro or a plain Node handler, and it was only ever in the React package because
that is where the browser backends live. Those stay: `createMemoryStorage`,
`createLocalStorage`, `createSessionStorage`, `createCookieStorage` and the
`subscribeAll` listener set are genuinely browser concerns.

**Nothing to change in your code.** `@viu/emporix-sdk-react` re-exports every
moved name from `./storage` and `/ssr`, with one definition only. One type is now
derived rather than re-declared: `PersistedAnonymousSession` is
`Pick<StoredAnonymousSession, "refreshToken" | "sessionId">`, which is what it
always was in practice — the browser adapters deliberately persist only those two
fields, while a server store may also keep the access token.
