---
"@viu/emporix-sdk": patch
---

chore(sdk): bump the type generator to @hey-api/openapi-ts 0.97.3

Answers two Dependabot alerts on the codegen. Regenerated from the **same** vendored
specs, so no Emporix API surface changes — only how the generator emits it: 88 files,
+2051/-352.

Two generated names disappear, both internal and neither reachable from the package
root: `_Error` and `_Object` are now emitted under their real names, `Error` and
`Object`. The bundler renames the collision away (`Object$1` in `dist/index.d.ts`), so
nothing shadows the globals and no export list mentions either name. Every other
exported name is unchanged; 102 are new.

`jiti` is pinned to `2.6.1` in the root `pnpm.overrides` as part of this change.
Bumping the generator pulls `jiti` to 2.7.0 through `c12`, which re-resolves every
`vite`, `vitest` and `eslint` peer in the tree — and with that resolution the
`packages/react` suite fails intermittently: 2 failures in 6 runs, against 0 in 9 runs
without it. Pinning `jiti` restores 6 of 6. The pin is a quarantine, not a diagnosis:
the underlying reason jiti 2.7.0 destabilises that suite is unknown and will need
finding before the pin can go.
