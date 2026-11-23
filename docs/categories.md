# Categories

Category reads and back-office writes through `client.categories`. The
single-category writes (`create`, `update`, `patch`, `delete`) and the
`assignments` helpers are described in their JSDoc; this page covers the bulk
writes added upstream on 2026-11-23 and the traps they share. Localized writes
and the `contentLanguage` option are explained in
[`products.md`](./products.md#localized-writes).

## Bulk writes

All three take up to 200 entries, default to the service token
(`category.category_manage`), and answer `207` Multi-Status with one result per
entry in request order. A failed entry does **not** throw — check every `code`.
An empty array resolves to `[]`; more than 200 entries fail the whole call with
`400` before anything is written.

```ts
// Create — a supplied id is kept, otherwise the service generates one
const created = await admin.categories.bulkCreate(
  [
    { id: "beverages", localizedName: { en: "Beverages", de: "Getränke" }, published: true },
    { localizedName: { en: "Snacks", de: "Snacks" }, published: true },
  ],
  { publish: true },
);

// Partial update — every entry needs the stored metadata.version
await admin.categories.bulkPatch([
  { id: "beverages", localizedName: { en: "Beverages and drinks" }, metadata: { version: 1 } },
]);

// Remove one category's assignments by reference id (e.g. product ids)
await admin.categories.assignments.bulkRemoveByReference("beverages", ["1639265", "1639266"]);
```

| Trap | Detail |
| --- | --- |
| `publish` must agree with `published` | On `bulkCreate` the `publish` option has to match `published` on every entry; on `bulkPatch`, on every entry that sets it. Publishing needs `category.category_publish`, unpublishing `category.category_unpublish`. |
| Optimistic locking per entry | `bulkPatch` requires `metadata.version` on each entry, and it must match the stored category. Read before you patch. |
| `bulkPatch` never creates | An unknown `id` fails its entry instead of creating a category. |
| Assignment delete is scoped | `bulkRemoveByReference` only touches `categoryId`; the same reference on another category stays. For tenant-wide removal use `assignments.removeAllByReference`. An unknown reference is a `404` entry. |
| Results carry details | A failed entry has `message` and, for validation errors, `details[].message`. |

None of the three has been verified against a live tenant yet.
