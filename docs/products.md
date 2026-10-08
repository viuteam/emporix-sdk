# Products

`client.products` reads the Emporix Product Service. Standard reads: `get`,
`getByCode`, `list` / `listAll`, `search`, `searchByIds`, `searchByCodes`.

## Bulk fetch by id or code

`searchByIds` and `searchByCodes` bulk-fetch via `POST /products/search`,
chunking at 100 (override with `{ chunkSize }`). Order is **not** guaranteed —
re-index the result by `id` / `code`.

```ts
const byId = await client.products.searchByIds(["id1", "id2"]);
const byCode = await client.products.searchByCodes(["SKU-1", "SKU-2"]);
```

`searchByCodes` de-duplicates codes and **drops** any code containing `(`, `)`,
`,`, whitespace, or `"` (logging a warning with the dropped codes), because the
Emporix `q` syntax uses those characters as delimiters and does not support
escaping them in a plain IN-list. An empty input — or one with no safe codes —
returns `[]` without an HTTP call.

In React: `useProductsByCodes(codes, { chunkSize? })` (disabled while `codes` is
empty; 30s stale-time).

## Variant children

Emporix products have a `productType` of `BASIC`, `PARENT_VARIANT`, `VARIANT`, or
`BUNDLE`. A `PARENT_VARIANT` product's variants are separate `VARIANT` products
that reference the parent via `parentVariantId`. The SDK encapsulates the search
query so you don't build it by hand.

```ts
// All variant children as a flat array (loads every page; default pageSize 200)
const children = await client.products.listVariantChildren("PARENT-1");

// Streaming, page by page — for large variant sets
for await (const variant of client.products.listVariantChildrenAll("PARENT-1")) {
  render(variant);
}
```

A parent with no children resolves to `[]` (it never throws). Internally this
runs `search("productType:VARIANT parentVariantId:<id>")` — space-separated
fields are combined with implicit AND, per Emporix's query-parameter syntax.

## Localized writes

A localized field such as `name` or `description` is sent either as a plain
string or as a map of translations. The `Content-Language` request header tells
Emporix which of the two the body contains:

| `Content-Language` | Localized fields are | Example |
| --- | --- | --- |
| not sent (the SDK default) | strings in the tenant's default language | `name: "Chair"` |
| a language code, e.g. `"de"` | strings in that language | `name: "Stuhl"` |
| `"*"` | maps of translations | `name: { de: "Stuhl", en: "Chair" }` |

A map sent without the header fails with a `400`: «localized values must be of
String type when the Content-Language header is not set to all languages».

Set a default on the client, and every request with a body carries it:

```ts
const admin = new EmporixClient({
  tenant: "mytenant",
  credentials: { backend: { clientId, secret } },
  contentLanguage: "*",
});

await admin.products.create(product); // `name: { de: "Stuhl", en: "Chair" }` and friends
```

The product writes (`create`, `update`, `replace`, `bulkCreate`, `bulkUpdate`)
and the category writes (`create`, `update`, `patch`) override it per call:

```ts
// One plain German string, on a client whose default is "*"
await admin.products.update("p-1", { name: "Stuhl" }, { contentLanguage: "de" });
```

The other writes with localized fields — product templates, price models,
prices and price lists, catalogs, brands, currencies, segments, fees, schemas,
shipping, tax and units, among others — take no options argument and use the
client default. The template and price-model input types only allow maps, so
those writes need `contentLanguage: "*"`. When a single call needs a different
value, build a second client from the same config and hand it the first one's
token provider, which saves it from fetching a token of its own:

```ts
const german = new EmporixClient({
  ...config,
  contentLanguage: "de",
  tokenProvider: admin.tokenProvider,
});
// `name` is the German translation alone, as a plain string
await german.currencies.updateCurrency("CHF", { name: "Schweizer Franken", metadata: { version: 3 } });
```

- The header goes on every request with a body, `POST` searches and cart writes
  included, and never on a `GET`. Set it on the client that does back-office
  writes, not on a storefront client.
- Categories and catalogs always take maps. There the header only narrows the
  languages a payload may contain; without it, every tenant language is allowed.
- Reads are the other half. To get the maps back, read with `Accept-Language: *`
  (`client.setStorefrontContext({ language: "*" })`). A read in one language
  returns plain strings, so an editor built on it never sees the other
  translations.

## React

```tsx
import { useVariantChildren } from "@viu/emporix-sdk-react";

function VariantPicker({ parentId }: { parentId: string }) {
  const { data: variants } = useVariantChildren(parentId);
  return <>{variants?.map((v) => <Option key={v.id} variant={v} />)}</>;
}
```

The hook defaults to the anonymous/customer token (override via `options.auth`),
uses a 60s stale time, and its cache key contains `parentVariantId`.
