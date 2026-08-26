# @viu/emporix-sdk-angular

Angular bindings for the [Emporix](https://emporix.io) Commerce Engine: one
`provideEmporix()` wires the SDK, a storage backend and TanStack Query into an
Angular application, and signal-based `inject*` functions run reads with the same
cache keys and auth resolution as the React bindings.

Built with tsup rather than `ng-packagr`, because the package exports only
functions and contains no decorators — see
[`docs/angular.md`](../../docs/angular.md) for the API and
[the design spec](../../docs/superpowers/specs/2026-08-25-angular-package-design.md)
for why.

**Status: at parity with the React bindings.** 86 injectables covering 109 of
React's 111 hooks. The mapping is not one-to-one — 31 write operations are grouped
into 11 mutation bundles. The two hooks with no equivalent
(`useEmporixTelemetry`, `useEmporixErrorHandler`, both provider infrastructure)
and the four deliberate deviations are listed in `docs/angular.md`.
