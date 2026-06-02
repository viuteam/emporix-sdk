# Catalog Management

Bindings for the Emporix **Catalog Management** service
(`/catalog/{tenant}/catalogs`): CRUD over catalogs (distinct from the
category-tree `client.categories`).

> **Server-side.** Defaults to the service (clientCredentials) token
> (`catalog.catalog_view` / `catalog.catalog_manage`).

```ts
const catalogs = await client.catalogs.listCatalogs();
const c = await client.catalogs.getCatalog("catalog-id");

// all catalogs that contain a given category
const forCategory = await client.catalogs.getCatalogsForCategory("category-id");

// create / upsert — both return the catalog's id
const { id } = await client.catalogs.createCatalog({ /* … */ });
await client.catalogs.updateCatalog("catalog-id", { /* … */ }); // PUT upsert

// partial update (resolves to void) / delete
await client.catalogs.patchCatalog("catalog-id", { /* … */ });
await client.catalogs.deleteCatalog("catalog-id");
```

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
