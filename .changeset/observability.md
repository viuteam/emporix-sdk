---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add opt-in telemetry channel for observability + ops-tuning.

**SDK (additive)**
- `TokenProvider.onRefresh(listener)` — optional subscription to
  token-refresh events. `DefaultTokenProvider` implements it (anonymous
  refresh path).

**React (additive)**
- `<EmporixProvider onTelemetry={fn}>` — receives a typed event stream
  covering cache hit/miss, refetches, errors, mutations, auth refreshes,
  and storage writes.
- `useEmporixTelemetry()` — returns `{ emit }` for consumer-side custom
  events on the same channel.
- `EmporixStorage.subscribeAll(listener)` — optional subscription to all
  storage write events. Implemented in all three built-in adapters
  (memory, localStorage, cookie).

**Event types:**
- `cache.hit`, `cache.miss`, `query.refetch`, `query.error`
- `mutation.success`, `mutation.error`
- `auth.refresh`
- `storage.write`
- `custom`

No breaking changes. The entire telemetry layer is no-op when
`onTelemetry` is not passed. Existing `TokenProvider` / `EmporixStorage`
implementations continue to work without implementing the new optional
methods.
