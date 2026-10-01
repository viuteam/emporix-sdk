---
"@viu/emporix-sdk-react": patch
---

Deliver query-cache telemetry outside React renders.

When a component mounted onto cached data, an `onTelemetry` handler that sets
state, as a telemetry HUD does, made React log «Cannot update a component while
rendering a different component». TanStack Query builds a query's observer
during the component's render, and the new observer reports its cached result
to the query cache straight away. The SDK's cache listener passed the resulting
`cache.hit` to `onTelemetry` synchronously, so the handler ran in the middle of
another component's render.

The query-cache events (`cache.hit`, `cache.miss`, `query.refetch`,
`query.error`) now reach `onTelemetry` on a microtask after the cache
notification. Their payloads, `durationMs` included, are still taken when the
notification fires, and they keep their order among themselves. Mutation, auth,
storage, company and custom events are still delivered synchronously, so one of
those emitted in the same tick as a cache change can now arrive before the
cache event. A test that asserts a cache event right after the cache changed
needs a `waitFor`.
