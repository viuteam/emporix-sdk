# @viu/emporix-mixins

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
