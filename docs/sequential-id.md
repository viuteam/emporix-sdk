# Sequential ID Service

Bindings for the Emporix **Sequential ID Service** (`/sequential-id/{tenant}/…`):
server-managed, gap-free sequential identifiers (order numbers, invoice numbers,
etc.) generated from tenant-defined **sequence schemas**.

> **Server-side only.** Every endpoint requires the backend
> `sequentialid.schema_view` (read + next-id) / `sequentialid.schema_manage`
> (CRUD + set-active) scopes, served by the **service (clientCredentials)
> token**. Never construct these calls from a browser — the admin token must
> not be exposed. Use them in Node, Next.js route handlers / server actions, or
> other trusted backends.

## Schema admin — `client.sequentialIds`

```ts
// list all schemas
const schemas = await client.sequentialIds.listSchemas();

// create a schema (immutable — no update; delete + recreate to change)
const created = await client.sequentialIds.createSchema({
  name: "Order numbers",
  schemaType: "order",
  preText: "ORD-",
  startValue: 1,
  maxValue: 999999,
  numberOfDigits: 6,
});

// get one by id
const one = await client.sequentialIds.getSchema(created.id);

// mark a schema active for its type (only one active per type)
await client.sequentialIds.setActiveSchema(created.id);

// the active schema for a type
const active = await client.sequentialIds.listSchemasByType("order");

// delete
await client.sequentialIds.deleteSchema(created.id);
```

## Generating ids

```ts
// next id for a type (optional sub-pool key + placeholders)
const { id } = await client.sequentialIds.nextId("order", {
  sequenceKey: "store-1",
  placeholders: { yy: "26" },
});

// derive time/country placeholders from a site's settings
await client.sequentialIds.nextId("order", {}, { siteCode: "main" });

// batch: allocate several ids across schema types in one call
const batch = await client.sequentialIds.nextIdsBatch({
  order: { numberOfIds: 3 },
  invoice: { numberOfIds: 1, sequenceKey: "eu" },
});
batch.order?.ids; // ["ORD-000123", "ORD-000124", "ORD-000125"]
```

## Quirks

- **`maxValue` is a hard cap** — there is no auto-reset; allocation fails once
  the counter reaches it.
- **One active schema per type** — `setActiveSchema` switches which schema a
  type's `nextId` calls use.
- **Schemas are immutable** — the API has no PATCH/PUT. To change a schema,
  delete it and create a new one.
- **`sequenceKey`** creates an independent sub-pool counter under the same schema.
- **Batch path has no tenant segment** — `nextIdsBatch` posts to
  `/sequential-id/sequenceSchemaBatch/nextIds`; the service derives the tenant
  from the token. (The SDK handles this for you.)

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
