# Country Service

Bindings for the Emporix **Country Service** (`/country/{tenant}/…`): country and
region master data.

> **Server-side.** Defaults to the service token (`country.country_read` /
> `country.country_manage` / `country.region_read`); reads also work with an
> anonymous token. Countries are predefined — list/get/patch only (no
> create/delete). `patchCountry` resolves to `void` (204).

```ts
const countries = await client.countries.listCountries();
const de = await client.countries.getCountry("DE");
await client.countries.patchCountry("DE", { active: true });

const regions = await client.countries.listRegions();
const region = await client.countries.getRegion("DE-BY");
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.anonymous()` for storefront reads.
