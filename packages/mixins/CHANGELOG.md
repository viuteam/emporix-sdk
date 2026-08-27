# @viu/emporix-mixins

## 1.0.0

### Patch Changes

- Updated dependencies [[`148e09a`](https://github.com/viuteam/emporix-sdk/commit/148e09a687ad1a33d2451e383527245e2c10333d)]:
  - @viu/emporix-sdk@3.0.0

## 0.2.2

### Patch Changes

- [#277](https://github.com/viuteam/emporix-sdk/pull/277) [`f2b5def`](https://github.com/viuteam/emporix-sdk/commit/f2b5def1f125725602ca461f3cdd6b6cb485795c) Thanks [@amnael1](https://github.com/amnael1)! - docs: correct three stale claims in the SDK README, add the missing mixins LICENSE

  Checked every verifiable claim in the sdk, react and mixins READMEs against the
  code. The react one was clean. Three things in the SDK README were wrong:
  - **`credentials.backend` was marked «(required)»**. It is not: `validateConfig`
    requires only that the `credentials` object exists, so `credentials: {}` is a
    legal credential-free client — which is exactly what `examples/md-module` does,
    where the Managed Dashboard host owns the token. The table now marks
    `credentials` itself as required and explains the empty case.
  - **`customerGroups` was described as «read-only for now»**. It has `addMember`
    and `removeMember`, and the React README already documented the
    `useAddGroupMember` / `useRemoveGroupMember` hooks for them — the two READMEs
    contradicted each other.
  - **`availability` was described as a read-only service** naming two of its nine
    methods. It has three reads defaulting to `anonymous` and six writes
    (`create`, `update`, `delete`, `bulkCreate`, `bulkUpdate`, `bulkDelete`)
    defaulting to `service`.

  The documented tenant pattern was also the one from the error message
  (`^[a-z][a-z0-9]+$`) rather than the one the code applies
  (`^[a-z][a-z0-9]{2,15}$`); the prose «3–16 chars» was already right.

  **`@viu/emporix-mixins` was shipping without a LICENSE file.** Its `files` array
  has listed `LICENSE` since the changelog-links change, and `package.json`
  declares `"license": "MIT"`, but the file itself never existed — so the published
  tarball carried no license text. Added, identical to the other three packages.
  Its README also gains the CI/npm badges and the Authors and License sections the
  others have.

## 0.2.1

### Patch Changes

- [#257](https://github.com/viuteam/emporix-sdk/pull/257) [`a333cb2`](https://github.com/viuteam/emporix-sdk/commit/a333cb2550d23a6431d12beb15caba3092158722) Thanks [@amnael1](https://github.com/amnael1)! - docs: link the changelog from every package README

  npmjs.com renders only a package's README — the registry has no changelog field
  at all, so there is nothing for the website to show. Each README now carries a
  Changelog section pointing at `CHANGELOG.md` on GitHub, at the copy inside the
  published tarball (served by unpkg), and at the per-version Releases.

  Published as a patch on purpose: npmjs.com shows the README of the _published_
  version, so a docs-only change that is never released never reaches the page.

  `@viu/emporix-mixins` also gains `README.md`, `CHANGELOG.md` and `LICENSE` in its
  `files` array. It listed only `dist`, and while npm ships a README and a LICENSE
  regardless, it does **not** ship a CHANGELOG — verified against the published
  tarball, which had no `CHANGELOG.md`. The link the new section adds would have
  been dead.

## 0.2.0

### Minor Changes

- [#137](https://github.com/viuteam/emporix-sdk/pull/137) [`9ef7c51`](https://github.com/viuteam/emporix-sdk/commit/9ef7c51d933d9b78be1880ce19d6f7312ffcd20e) Thanks [@amnael1](https://github.com/amnael1)! - Add a type-safe mixin filter builder. `@viu/emporix-mixins` now exports
  `mixinQuery`/`and`/`or`/`raw` to build Emporix `q` filters from generated
  `MixinDescriptor`s, with attribute names and value types checked at compile
  time and the entity carried through `MixinDescriptor<T, E>` / `MixinFilter<E>`.
  Localized attributes are supported via a `{ lang, ... }` operator.
  `products.search` and `useProductSearch` accept a built filter (or a raw
  string); a new `resolveQuery` normalizer enforces the `compoundLogicalQuery`
  (OR) capability gate per service.

## 0.1.0

### Minor Changes

- 7b6f565: feat: initial release — generic mixin resolution + Schema-Service sync

  Runtime accessor (`readMixin` / `writeMixin` / `validateMixin` / `savedMixinVersion`),
  pluggable `MixinSource` adapters (`schemaService` default, `localFiles`,
  `cdnManifest`), and an `emporix-mixins` CLI (`pull` / `generate` / `check`) that
  generates versioned mixin types + a registry into the consumer repo and detects
  version drift.
