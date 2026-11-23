# Web Storage only where there is a document

**Status:** design, approach A approved on 2026-11-23. Not implemented.
**Size:** small change, shipped as a patch release of `@viu/emporix-sdk` ahead of
the Node 22/24/26 support work (a separate major release).

## Why

Node 26, Active LTS since 2026-10-28, defines Web Storage globals on the server:

| Runtime | `globalThis.sessionStorage` | `globalThis.localStorage` |
|---|---|---|
| Node 22, 24 | absent | absent |
| Node 26 | a `Storage` shared by the whole process | a getter: `undefined` plus an `ExperimentalWarning`; a persistent, process-wide store when started with `--localstorage-file` |
| Deno | — | a persistent store on disk |

`createSessionStorage()` and `createLocalStorage()` in
`packages/sdk/src/core/browser-storage.ts` use whichever global exists and only
fall back to memory when it is `undefined`. On a Node 26 server,
`createSessionStorage()` therefore writes into a store that every request in the
process shares. Two writers reach it during SSR:

- `useProviderWiring` (`packages/react/src/hooks/internal/use-provider-wiring.ts`)
  seeds `initialCustomerToken` during the first render, so on the server too;
- the token provider's anonymous store writes the anonymous session when a
  server-side prefetch mints a token.

One customer's token can then be read by the next request in the same process.
Found with a probe script on Node 26.13.1 and by reading the code; not
reproduced end to end through a Next.js app.

## Goals

- Wherever there is no `document`, both backends fall back to memory, as they
  do on Node 22 and 24 today.
- Browsers behave exactly as before.
- Reading `localStorage` on a server no longer triggers Node's
  `ExperimentalWarning`.
- Existing 4.x users get it as a patch, before the Node 26 support release.

## Non-goals

- `engines`, the CI matrix and the Node 26 test fixes: those belong to the major
  release, which drops Node 20 (Node 20 does not know the flag the tests need).
- The provider's render-phase seeding: it stays, see approach C.
- Cookie storage: it already goes through `document`.
- A way to opt into server-side Web Storage.

## Anti-goals

- Any store that requests of one server process share.
- A change in what a browser stores, or where.
- Detecting a runtime by name.

## Constraints

- `packages/sdk` compiles with `lib: ["ES2022"]` and no `"DOM"`. Globals are
  reached through the narrowed `globalThis` (`BrowserGlobals`) the file already
  uses.
- Check `document` **before** reading `localStorage`: on Node 26 the read itself
  is what emits the warning.
- The existing fallback warning (`[emporix] localStorage unavailable; falling back
  to in-memory storage`) stays. It is what a Node 22/24 server prints today.

## Approaches

| | Approach | Trade-off | Decision |
|---|---|---|---|
| **A** | Use Web Storage only when `document` exists as well | One place in the SDK; React, Angular and Next inherit it. Covers Node 26, `--localstorage-file`, Deno and any future runtime. Someone who deliberately used Deno's `localStorage` on a server now gets memory, which is the safe default | **picked** |
| B | Detect Node (`process.versions.node`) and skip Web Storage there | Leaves Deno and other runtimes exposed; checks a runtime instead of a capability | rejected |
| C | Stop the React provider from writing during SSR | Fixes one writer only: the anonymous-session write and Angular stay exposed. Reverses the decision that the first render already sees the token | rejected |

## Design

- `browser-storage.ts` gets one internal helper that returns the named Web
  Storage only when `browser.document` is defined, and `undefined` otherwise.
  `createLocalStorage` and `createSessionStorage` read their store through it;
  everything after that line is unchanged.
- The JSDoc of both functions says they fall back to memory wherever there is no
  `document`, and why: Node 26's built-in `sessionStorage` would otherwise be
  shared by every request.
- Tests in `packages/sdk` (Node environment, deterministic on every Node
  version, because the globals are stubbed rather than taken from the runtime):
  - with a recording fake `sessionStorage` / `localStorage` and no `document`,
    both backends fall back to memory and never write to the fake;
  - with a stubbed `document`, both use the fake, as in a browser;
  - without `document`, the `localStorage` getter is never invoked, which is
    what keeps Node's warning away.
- The React storage tests (jsdom, which has a `document`) stay as they are and
  keep covering the browser path.
- Changeset: `patch` for `@viu/emporix-sdk`. React, Angular and Next take the
  fix through their dependency on it.

## Verification

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Break on purpose: drop the `document` check, and the new SDK tests must fail.
- On Node 26: import `createSessionStorage` from the built `dist`, write a value
  through one instance, and confirm that a second instance does not see it.

## Left to the builder

- The helper's name.
- Whether a sentence in `docs/react.md` or the React README, where storage
  backends are chosen, is worth adding.
