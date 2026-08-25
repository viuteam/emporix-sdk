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

**Status: foundation.** 33 of the React package's 107 hooks are planned; see
`docs/angular.md` for what is and is not here yet.
