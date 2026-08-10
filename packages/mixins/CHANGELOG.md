# @viu/emporix-mixins

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
