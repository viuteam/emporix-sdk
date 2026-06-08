---
"@viu/emporix-mixins": minor
---

feat: initial release — generic mixin resolution + Schema-Service sync

Runtime accessor (`readMixin` / `writeMixin` / `validateMixin` / `savedMixinVersion`),
pluggable `MixinSource` adapters (`schemaService` default, `localFiles`,
`cdnManifest`), and an `emporix-mixins` CLI (`pull` / `generate` / `check`) that
generates versioned mixin types + a registry into the consumer repo and detects
version drift.
