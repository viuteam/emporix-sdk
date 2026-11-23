---
"@viu/emporix-sdk": major
"@viu/emporix-sdk-react": major
"@viu/emporix-sdk-angular": minor
"@viu/emporix-sdk-next": major
"@viu/emporix-mixins": major
---

feat(repo): support node 22, 24 and 26

The packages now support the Node.js LTS lines 22, 24 and 26, and later LTS lines: `engines.node` is `^22.12.0 || ^24.0.0 || >=26.0.0`.

- **Node 20 is no longer supported.** It has been end of life since 2026-04-30.
- **The odd lines 23 and 25 are outside the range.** They are not LTS and are end of life.
  - npm and pnpm only warn about this.
  - Yarn 1 and installs with `engine-strict=true` fail.
- **Node 26**, the active LTS since 2026-10-28, is tested alongside 22 and 24.

There are no API changes. If you run Node 22.12+, 24 or 26, upgrading is a version bump. Bump all `@viu/emporix-*` packages together: their peer ranges move to the new majors, and npm 7+ rejects a mix of old and new majors with `ERESOLVE`. `@viu/emporix-sdk-angular` is still 0.x, so this breaking change is a minor bump there.
