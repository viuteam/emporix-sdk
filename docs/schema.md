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

// create
await client.schemas.createSchema({
  name: { en: "Product extras" },
  types: ["PRODUCT"],
  attributes: [{ key: "warranty", name: { en: "Warranty" }, type: "TEXT" }],
});

// update — metadata.version is REQUIRED (409 on a stale version)
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

// set the entity types a schema applies to
await client.schemas.setSchemaTypes("product-extras", ["PRODUCT", "CART"]);
```

## Custom entities

```ts
const entities = await client.schemas.listCustomEntities({ expandSchemas: true });
const shoe = await client.schemas.getCustomEntity("shoe");
await client.schemas.createCustomEntity({ name: { en: "Shoe" }, attributes: [] });
await client.schemas.updateCustomEntity("shoe", { name: { en: "Sneaker" }, attributes: [] });
await client.schemas.deleteCustomEntity("shoe"); // 409 if instances/schemas still exist
```

## Custom instances

The custom-entity `type` is always the first argument. Pin the `mixins` shape
with a generic.

```ts
interface ShoeMixins { size: number; color: string }

const page = await client.schemas.listInstances<ShoeMixins>("shoe");
const one = await client.schemas.getInstance<ShoeMixins>("shoe", "instance-id");
await client.schemas.createInstance<ShoeMixins>("shoe", {
  name: { en: "Runner" },
  mixins: { size: 42, color: "black" },
});
await client.schemas.replaceInstance<ShoeMixins>("shoe", "instance-id", {
  name: { en: "Runner" },
  mixins: { size: 43, color: "black" },
});
await client.schemas.patchInstance<ShoeMixins>("shoe", "instance-id", {
  mixins: { size: 44, color: "black" },
});
await client.schemas.deleteInstance("shoe", "instance-id");

// structured search
const found = await client.schemas.searchInstances<ShoeMixins>("shoe", { /* filter body */ });
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

## Not yet bound

Schema **references** (multipart upload/download), **export/import**, and
**bulk** instance operations are not yet exposed — see the design spec's
"Out of scope" section.
