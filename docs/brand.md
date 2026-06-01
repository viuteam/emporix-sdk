# Brand Service

Bindings for the Emporix **Brand Service** (`/brand/brands`): CRUD over brands.

> **Server-side.** Defaults to the service (clientCredentials) token. Brand
> **reads** require no scope (work with an anonymous token too); writes need
> `brand.brand_manage`, delete needs `brand.brand_delete`. The path carries no
> tenant segment — the tenant comes from the token.

```ts
const brands = await client.brands.listBrands();
const brand = await client.brands.getBrand("brand-id");
await client.brands.createBrand({ name: "Acme" });
await client.brands.updateBrand("brand-id", { name: "Acme Corp" });
await client.brands.patchBrand("brand-id", { name: "Renamed" });
await client.brands.deleteBrand("brand-id");
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.anonymous()` for storefront reads or
`auth.service("other-set")` for a different credential set.
