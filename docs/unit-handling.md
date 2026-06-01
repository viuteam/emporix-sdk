# Unit Handling Service

Bindings for the Emporix **Unit Handling Service** (`/unit-handling/{tenant}/…`):
units CRUD, unit types, and conversion commands.

> **Server-side.** Defaults to the service (clientCredentials) token
> (`unithandling.unit_manage`).

```ts
const units = await client.units.listUnits();
const kg = await client.units.getUnit("KG");
await client.units.createUnit({ code: "KG", /* … */ });
await client.units.updateUnit("KG", { /* … */ });
await client.units.deleteUnit("KG");

// bulk delete by codes (sent as the request body)
await client.units.deleteUnits(["KG", "G"]);

// unit types + conversion commands
const types = await client.units.listUnitTypes(); // string[]
const factor = await client.units.getConversionFactor({ /* from/to … */ });
const result = await client.units.convertUnit({ /* from/to/value … */ });
```

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
