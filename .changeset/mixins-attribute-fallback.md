---
"@viu/emporix-mixins": patch
---

fix(mixins): read schema attributes as the Schema Service returns them in the codegen fallback

When the hosted JSON Schema of a mixin cannot be fetched, the codegen converts the schema's attributes instead. That conversion now reads `metadata.required` and `metadata.nullable`, takes `ENUM` values from their `{ value }` objects, and applies an `ARRAY`'s `arrayType` — its element type, `localized`, `nullable` and nested `attributes` — to each item. Before, every array came out as `string[]`, no attribute was ever required, and enum values were objects. Localized attributes are typed too: a localized `OBJECT` as a language-keyed map, a localized `TEXT` as a map or a `{ language, value }[]` array, since the attributes do not say which language schema version the tenant runs.
