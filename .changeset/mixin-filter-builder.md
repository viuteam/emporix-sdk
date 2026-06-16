---
"@viu/emporix-mixins": minor
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add a type-safe mixin filter builder. `@viu/emporix-mixins` now exports
`mixinQuery`/`and`/`or`/`raw` to build Emporix `q` filters from generated
`MixinDescriptor`s, with attribute names and value types checked at compile
time and the entity carried through `MixinDescriptor<T, E>` / `MixinFilter<E>`.
Localized attributes are supported via a `{ lang, ... }` operator.
`products.search` and `useProductSearch` accept a built filter (or a raw
string); a new `resolveQuery` normalizer enforces the `compoundLogicalQuery`
(OR) capability gate per service.
