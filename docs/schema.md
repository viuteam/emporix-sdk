# Schema Service

Bindings for the Emporix **Schema Service** (`/schema/{tenant}/…`): schemas
(typed attribute definitions on native entities), entity types, custom entities,
and custom-entity instances ("mixins" data).

> **Server-side only.** Every endpoint requires the backend
> `schema.schema_*` / `schema.custominstance_*` scopes, served by the
> **service (clientCredentials) token**. Never construct these calls from a
> browser — the admin token must not be exposed. Use them in Node, Next.js
> route handlers / server actions, or other trusted backends.

## Schemas — `client.schemas`

```ts
// list (paginated; optional q / type filter)
const page = await client.schemas.listSchemas({ type: "PRODUCT" });
for (const s of page.items) console.log(s.id, s.name);

// get one
const schema = await client.schemas.getSchema("product-extras");

// create — `id` is the mixin key the data is stored under (`mixins.productExtras`);
// resolves to `{ id }`, the 201's id envelope
const { id } = await client.schemas.createSchema({
  id: "productExtras",
  name: { en: "Product extras" },
  types: ["PRODUCT"],
  attributes: [{ key: "warranty", name: { en: "Warranty" }, type: "TEXT" }],
});

// update — metadata.version is REQUIRED (409 on a stale version); resolves on the 204
await client.schemas.updateSchema("product-extras", {
  name: { en: "Product extras" },
  types: ["PRODUCT"],
  attributes: [],
  metadata: { version: schema.metadata?.version ?? 0 },
});

// delete
await client.schemas.deleteSchema("product-extras");

// validate a schema document without persisting it
const result = await client.schemas.validateSchemaFile({
  name: { en: "Draft" }, types: ["PRODUCT"], attributes: [],
});
```

## Entity types

```ts
// types that currently have at least one schema
const types = await client.schemas.listTypes();

// set the entity types a schema applies to — native types or custom entity ids
await client.schemas.setSchemaTypes("product-extras", ["PRODUCT", "CART"]);
```

`types` (in `createSchema`, `setSchemaTypes` and the `listSchemas` filter) is a
`SchemaTargetType`: one of the native `SchemaTypeName`s or the id of a custom
entity, such as `"SHOE"`.

## Custom entities

```ts
const entities = await client.schemas.listCustomEntities({ expandSchemas: true });
const shoe = await client.schemas.getCustomEntity("SHOE");
// the id is required: uppercase letters, digits and underscores → { id }
await client.schemas.createCustomEntity({ id: "SHOE", name: { en: "Shoe" } });
// an upsert: { id } when it created the type (201), undefined when it updated it (204)
await client.schemas.updateCustomEntity("SHOE", { name: { en: "Sneaker" }, metadata: { version: 1 } });
await client.schemas.deleteCustomEntity("SHOE"); // 409 if instances/schemas still exist
```

A custom entity carries no attributes of its own: its fields come from schemas
whose `types` include the entity's id.

## Custom instances

The custom-entity `type` is always the first argument. Pin the `mixins` shape
with a generic.

```ts
interface ShoeMixins { size: number; color: string }

const page = await client.schemas.listInstances<ShoeMixins>("SHOE");
const one = await client.schemas.getInstance<ShoeMixins>("SHOE", "instance-id");

// `id` is optional (generated when left out) → { id }; an existing id is a 409
const { id } = await client.schemas.createInstance<ShoeMixins>("SHOE", {
  id: "runner",
  name: { en: "Runner" },
  mixins: { size: 42, color: "black" },
});

// full PUT, an upsert: { id } when it created (201), undefined when it replaced (204).
// metadata.version enables optimistic locking — a stale one is a 409.
await client.schemas.replaceInstance<ShoeMixins>("SHOE", "runner", {
  name: { en: "Runner" },
  mixins: { size: 43, color: "black" },
  metadata: { version: one.metadata?.version },
});

// RFC-6902 operations; resolves on the 204
await client.schemas.patchInstance("SHOE", "runner", [
  { op: "replace", path: "/mixins/size", value: 44 },
  { op: "add", path: "/mixins/careInstructions/-", value: { step: 1, text: "Air dry" } },
]);
await client.schemas.deleteInstance("SHOE", "runner");

// structured search
const found = await client.schemas.searchInstances<ShoeMixins>("SHOE", { /* filter body */ });
```

None of the writes returns the instance. Read it back with `getInstance` when
you need its new `metadata.version`.

A conflict — a stale `metadata.version`, an id that already exists, an entity
still in use — is thrown as `EmporixConflictError` (status 409):

```ts
import { EmporixConflictError } from "@viu/emporix-sdk";

try {
  await client.schemas.replaceInstance("SHOE", "runner", draft);
} catch (e) {
  if (e instanceof EmporixConflictError) {
    // re-read, merge, retry
  }
  throw e;
}
```

## Writing instance data

Checked against a live tenant (2026-10-21), and not spelled out in the spec:

- **References.** A `REFERENCE` attribute's value is written — and read back —
  as `{ id, emporixReferenceType }`, e.g.
  `{ id: "order-1", emporixReferenceType: "ORDER" }`.
- **Arrays of objects.** The item properties of an `ARRAY` of `OBJECT` live in
  `arrayType.attributes`. The spec's `arrayType` has no `attributes`, so
  `SchemaAttribute` does not type it either — cast the attribute you write.
- **Localized maps.** A write whose localized fields — the instance `name`, a
  localized mixin attribute — are maps of translations needs
  `Content-Language: *`. Set `contentLanguage: "*"` on the client that does the
  writes (see `EmporixConfig.contentLanguage`); without it the API answers 400.

## Bulk, export and import

```ts
// bulk writes (up to 200 items) — bulkCreateInstances, bulkUpsertInstances,
// bulkPatchInstances, bulkDeleteInstances. Each returns a 207 envelope — success
// overall, per-item outcome in each result's `code`/`status`.
const results = await client.schemas.bulkPatchInstances("SHOE", [
  { id: "a", data: [{ op: "replace", path: "/mixins/size", value: 45 }] },
]);
results[0]?.code; // 204 on success
await client.schemas.bulkDeleteInstances("SHOE", ["a"]);

// export custom entities and their schemas, then import them elsewhere
const exported = await client.schemas.exportCustomEntities(["SHOE"]);
await client.schemas.importCustomEntities({ data: exported.data });
```

## References

Reference entities (`/references`) — a schema attached to an uploaded JSON file.
Create and update are `multipart/form-data`; pass the file as a `Blob` or a
plain object.

```ts
const page = await client.schemas.references.list({ type: "PRODUCT" });
const ref = await client.schemas.references.get("ref-id");
const { id } = await client.schemas.references.create({
  file: { attributes: [] },
  body: { name: { en: "Shared attributes" }, types: ["PRODUCT"] },
});
await client.schemas.references.update(
  id!,
  { file: { attributes: [] }, body: { name: { en: "Shared" }, types: ["PRODUCT"] } },
  { version: 1 }, // 409 on a stale version
);
await client.schemas.references.delete(id!);
```

## Schema attribute types

`SchemaAttribute.type` is one of `TEXT`, `NUMBER`, `DECIMAL`, `BOOLEAN`,
`DATE`, `TIME`, `DATE_TIME`, `ENUM` (`values`), `ARRAY` (`arrayType`),
`OBJECT` (nested `attributes`), or `REFERENCE` (custom entities only). The
optional `metadata` carries `readOnly` / `localized` / `required` / `nullable`.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
