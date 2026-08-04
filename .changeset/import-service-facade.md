---
"@viu/emporix-sdk": minor
---

Add `client.imports` — bindings for the Emporix Import Service
(`/importtool/{tenant}/…`), covering all 15 operations of the new spec: import
configurations and streams, cron schedules, run control, run errors, and the
imported records.

Server-side only: every operation needs the service token with the
`importtool.import_trigger` scope. There is no customer or anonymous variant,
which is why `@viu/emporix-sdk-react` ships no hooks for it — a hook would mean
a client-credentials secret in the browser bundle. Full guide in
[`docs/import.md`](https://github.com/viuteam/emporix-sdk/blob/main/docs/import.md).

Three shapes worth knowing before you call it:

- `getSchedule(configId)` resolves to `null`, not a throw, when no schedule is
  configured — the service answers `204`, so an unscheduled configuration is a
  normal result.
- The four paginated methods return `ImportPage<T>`, which is `PaginatedItems<T>`
  plus `totalElements` / `totalPages`. This is the first paginated SDK surface
  where `hasNextPage` is exact rather than guessed from `items.length ===
  pageSize`, and the reported `pageNumber` / `pageSize` echo what the service
  used, because it clamps `size`. The facade stays one-based.
- `streamRun(runId)` yields a discriminated union
  (`snapshot` / `stream` / `run` / `unknown`) over Server-Sent Events. The
  `unknown` arm is deliberate: the service is in preview, so a new event name or
  an unreadable payload must neither abort a running import nor vanish silently.

Upstream marks all 15 operations as preview and makes nearly every response field
optional. The tests pin URL, method, query, body and auth kind; the response
shapes come from the spec and have not been seen on the wire — verifying them
needs a service account with the import scope, which this repo has no credentials
for.
