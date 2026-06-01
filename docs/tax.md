# Tax Service

Bindings for the Emporix **Tax Service** (`/tax/{tenant}/…`): per-location tax
configurations (country + tax classes) and net/gross tax calculation.

> **Server-side only.** Every endpoint requires a backend `tax.tax_read` /
> `tax.tax_manage` scope, served by the **service (clientCredentials) token**.
> Never construct these calls from a browser — the admin token must not be
> exposed. Use them in Node, Next.js route handlers / server actions, or other
> trusted backends. There is no React binding.

## Tax configurations — `client.taxes`

```ts
// list / get
const configs = await client.taxes.listTaxConfigs();
const de = await client.taxes.getTaxConfig("DE");

// create — returns just { locationCode }
const { locationCode } = await client.taxes.createTaxConfig({
  location: { countryCode: "DE" },
  taxClasses: [
    { code: "STANDARD", name: { en: "Standard" }, rate: 19, order: 1, isDefault: true },
    { code: "REDUCED", name: { en: "Reduced" }, rate: 7, order: 2 },
  ],
});

// update — metadata.version is REQUIRED (409 on a stale version)
await client.taxes.updateTaxConfig("DE", {
  location: { countryCode: "DE" },
  taxClasses: [{ code: "STANDARD", name: { en: "Standard" }, rate: 19, order: 1, isDefault: true }],
  metadata: { version: de.metadata?.version ?? 0 },
});

// delete
await client.taxes.deleteTaxConfig("DE");
```

## Tax calculation

```ts
const result = await client.taxes.calculateTax({
  input: {
    targetLocation: { countryCode: "DE" },
    targetTaxClass: "STANDARD",
    price: 100,
    includesTax: false, // net → gross
  },
});
result.output?.netPrice;      // 100
result.output?.grossPrice;    // 119
result.output?.targetTaxRate; // 19
```

`sourceLocation` / `sourceTaxClass` are required only when `includesTax` is
`true` (i.e. converting an existing gross price between tax contexts).

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
