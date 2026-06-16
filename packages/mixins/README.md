# @viu/emporix-mixins

Generic, tenant-agnostic toolkit to resolve Emporix mixins as typed values and
keep the types in sync with the Schema Service. Ships **no tenant data** — you
configure a source and generate types into your own repo.

## Runtime

```ts
import { readMixin, writeMixin, validateMixin } from "@viu/emporix-mixins";
import { mixins } from "./mixins/generated/registry";

const opts = readMixin(customer, mixins.deliveryOptions);                     // typed | undefined
const body = writeMixin({}, mixins.deliveryOptions, { packaging: "Paper" });  // sets mixins + metadata.mixins
const res  = await validateMixin(opts, mixins.deliveryOptions);              // { valid, errors? } (needs optional peer `ajv`)
```

- `readMixin` is sync, returns the typed value (or `undefined`), and warns when
  the entity's saved version differs from the loaded type.
- `writeMixin` sets `mixins[key]` **and** `metadata.mixins[key] = descriptor.url`.
- `validateMixin` is async and lazy-loads `ajv` (install it only if you validate).

## Filter builder

Build type-safe Emporix `q` filters from a generated descriptor to search
entities by mixin attribute. Attribute names and value types are checked against
the descriptor's type, and the entity is carried so a filter can't be passed to
the wrong service.

```ts
import { mixinQuery, and, or, raw } from "@viu/emporix-mixins";
import { mixins } from "./mixins/generated/registry";

const q = mixinQuery(mixins.attrs, {
  color: "Blue",                       // equals
  qty: { gte: 10, lte: 20 },           // range
  size: { in: ["S", "M"] },            // in-list
  promo: { exists: true },             // present
  title: { lang: "en", eq: "Sale" },   // localized → mixins.attrs.title.en:Sale
});

await client.products.search(q);   // also categories.search, orders.listMine({ q }), …
```

- `and(...)` joins with a space (AND); `or(...)` emits `compoundLogicalQuery`,
  which is only valid on compound-capable services (Product, Approval,
  Availability, Quote, Schema).
- `raw(fragment)` is an escape hatch for a non-mixin clause.
- Values containing whitespace throw (the `q` escaping is unverified) — use `raw()`.

See [`../../docs/mixin-search.md`](../../docs/mixin-search.md) for the capability matrix.

## Codegen (CLI)

`emporix-mixins.config.ts`:

```ts
import { schemaService } from "@viu/emporix-mixins/codegen";
import { client } from "./src/emporix";
import { auth } from "@viu/emporix-sdk";

export default {
  source: schemaService({ client, auth: auth.service() }),
  out: "src/mixins/generated",
  lockfile: "src/mixins/mixins.lock.json",
};
```

```bash
npx emporix-mixins pull && npx emporix-mixins generate   # commit the output
npx emporix-mixins check                                  # CI drift gate (exits non-zero on drift)
```

Built-in sources: `schemaService` (default — reads the tenant Schema Service,
fetches the hosted JSON Schema with an attribute-conversion fallback),
`localFiles`, `cdnManifest`.

## Custom source

Anything that returns `RawMixin[]` is a source:

```ts
import type { MixinSource } from "@viu/emporix-mixins/codegen";

const mySource: MixinSource = {
  async list() {
    return [/* { key, entity, version, url, schema } */];
  },
};
```

## Drift workflow (copy into your repo)

```yaml
# .github/workflows/mixin-drift.yml
on:
  schedule: [{ cron: "0 6 * * *" }]
  workflow_dispatch: {}
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm i
      - run: npx emporix-mixins pull && npx emporix-mixins generate
      - uses: peter-evans/create-pull-request@v6
        with:
          title: "chore(mixins): sync schema versions"
          branch: "mixins/sync"
```

A new (Emporix-assigned) schema version surfaces as a PR bumping `mixins.lock.json`
and the generated types — review the type diff and merge to adopt it.
