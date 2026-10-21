---
"@viu/emporix-sdk": minor
---

Align the Schema Service writes with the spec, and add `EmporixConflictError`.

- **`patchInstance` sends RFC-6902 operations.** It sent a partial instance, which the API does not take; it now takes a `CustomInstancePatch` (`[{ op, path, value }]`) and resolves on the `204`.
- **Type change — the writes resolve to what the API answers.** `createSchema`, `createCustomEntity` and `createInstance` resolve to the `201`'s id envelope (`SchemaCreated`, `CustomEntityCreated`, `CustomInstanceCreated`). `updateCustomEntity` and `replaceInstance` are upserts: the id envelope on a `201`, `undefined` on a `204`. `updateSchema`, `setSchemaTypes` and `patchInstance` resolve to `void`. They promised the full resource before, which never came back.
- **Type change — the drafts follow the spec.** `SchemaDraft` takes the mixin key `id`; `CustomInstanceDraft` takes an own `id`, `owner` and `metadata.mixins`; `replaceInstance` takes the new `CustomInstanceReplace` with `metadata.version` for optimistic locking. `CustomEntityDraft` now requires `id` and has no `attributes` (the API takes neither shape otherwise); `updateCustomEntity` takes the new `CustomEntityUpdate` (`name`, `metadata.version`).
- **Custom entity types as schema targets.** `SchemaDraft.types`, `setSchemaTypes` and the `listSchemas` filter take a `SchemaTargetType` — a `SchemaTypeName` or the id of a custom entity, which the spec allows.
- **`EmporixConflictError`.** A `409` — a stale `metadata.version`, an id that already exists — is now thrown as `EmporixConflictError` instead of a plain `EmporixError`. It extends `EmporixError`, so existing catches still work.

The type changes only affect code that, per the spec, did not work before — hence a minor rather than a major.
