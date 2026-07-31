---
"@viu/emporix-sdk-react": minor
---

Server-runtime support on the `./ssr` entry.

- `createServerStorage(jar)` — an `EmporixStorage` over a caller-supplied cookie
  jar, for RSC / Server Actions / Route Handlers / loaders. Synchronous, so
  `await cookies()` stays with the caller. Read-only unless a `set` accessor is
  given (Next forbids cookie writes during a Server Component render); writes
  then no-op and warn once per key.
- `serverAuth(storage)` — resolves the same `AuthContext` the client hooks
  resolve (customer if a token is stored, else anonymous). `authKind` is part of
  every query key, so this prevents silent cache misses.
- `prefetchEmporix(qc, opts)` — server-side prefetch for any read hook whose key
  is built with `emporixKey`, replacing the need for a helper per resource.
  `prefetchProduct` / `prefetchCart` / `prefetchOrder` keep their signatures and
  are now wrappers.

No new dependency and no `next` import — the jar shape works for any server
framework. `useAvailability` / `useAvailabilities` are not prefetchable; their
keys predate `emporixKey`. See `docs/react.md`.
