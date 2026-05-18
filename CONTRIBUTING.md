# Contributing

## Conventional Commits (history hygiene only)

Commit messages are enforced via `commitlint` + a husky `commit-msg` hook.
They do **not** drive version numbers — Changesets does. The husky `pre-commit`
hook runs `pnpm lint && pnpm typecheck`.

Format: `type(scope): subject`. Allowed scopes (see `commitlint.config.js`):
`repo`, `release`, `sdk`, `react`, `core`, `customer`, `product`, `category`,
`cart`, `auth`, `http`, `logger`, `deps`, `docs`, `examples`.

```
feat(cart): add coupon support
fix(customer): thread anonymous token through login
docs: document the SSO token-exchange seam
```

## Changesets — declaring release intent

Before opening a PR that changes `packages/*/src/**`, run:

```bash
pnpm changeset
```

Pick the affected package(s), bump level, and a summary. This writes
`.changeset/<name>.md`, reviewed like any other file. CI fails a PR that
touches `packages/*/src/**` without a changeset, unless it is labelled
`no-release`.

### Examples

**sdk-only change**

```md
---
"@viu/emporix-sdk": minor
---

Add ProductService.search().
```

**react-only change**

```md
---
"@viu/emporix-sdk-react": patch
---

Fix useCart enabled flag when cartId is undefined.
```

**both packages**

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": patch
---

Add cart coupon API; React hooks pick up the new types.
```

`updateInternalDependencies: patch` means an `@viu/emporix-sdk` release
auto-bumps `@viu/emporix-sdk-react` to point at it. Example packages
(`@viu/emporix-examples-*`) are ignored by Changesets.

## Two-PR release flow

1. Merge feature PRs (each with its changeset) into `main`.
2. The Changesets action opens/updates a **"Version Packages"** PR with version
   bumps and changelog entries.
3. Merging that PR publishes to npm (with provenance) and creates GitHub
   releases.

## Pre-releases (`next` dist-tag)

```bash
pnpm changeset pre enter next
# add changesets as usual, merge PRs
pnpm changeset version   # 1.0.0-next.0, .1, …
git push                 # publishes to the `next` dist-tag
pnpm changeset pre exit  # when ready for a stable release
```

## Local checks

```bash
pnpm typecheck   # repo-wide
pnpm test        # packages
pnpm build       # packages
```
