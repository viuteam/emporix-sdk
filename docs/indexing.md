# Indexing Service

Bindings for the Emporix **Indexing Service** (`/indexing/{tenant}/…`):
search-index provider configurations and reindex.

> **Server-side.** Defaults to the service (clientCredentials) token
> (`indexing.search_view` / `indexing.search_manage`).

```ts
const configs = await client.indexing.listConfigurations();
const algolia = await client.indexing.getConfiguration("algolia");
await client.indexing.createConfiguration({ provider: "algolia", /* … */ });
await client.indexing.updateConfiguration("algolia", { /* … */ });
await client.indexing.deleteConfiguration("algolia");

// public (read) configurations
await client.indexing.listPublicConfigurations();
await client.indexing.getPublicConfiguration("algolia");

// trigger a reindex
await client.indexing.reindex({ /* … */ });
```

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
