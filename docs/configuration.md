# Configuration Service

Bindings for the Emporix **Configuration Service** (`/configuration/{tenant}/…`):
tenant-wide and per-client key/value configuration.

> **Server-side only.** Every endpoint requires the backend
> `configuration.configuration_view` / `configuration.configuration_manage`
> scopes, served by the **service (clientCredentials) token**. Never construct
> these calls from a browser — the admin token must not be exposed. Use them in
> Node, Next.js route handlers / server actions, or other trusted backends.

## Tenant configurations — `client.tenantConfig`

```ts
// list (optionally filter by keys)
const all = await client.tenantConfig.list();
const some = await client.tenantConfig.list({ keys: ["checkout", "flags"] });

// get one, with a typed value
const checkout = await client.tenantConfig.get<{ mode: "b2c" | "b2b" }>("checkout");
checkout.value.mode; // typed

// create (array in, array out)
await client.tenantConfig.create([{ key: "flags", value: { newCart: true } }]);

// update one
await client.tenantConfig.update("flags", { key: "flags", value: { newCart: false } });

// delete one
await client.tenantConfig.delete("flags");
```

## Client configurations — `client.clientConfig`

The first argument is always the client id; `client` is injected into write bodies.

```ts
const cfgs = await client.clientConfig.list("saas-ag.caas-indexing-service-client");
const one = await client.clientConfig.get<boolean>("saas-ag.x", "algolia_activation");
await client.clientConfig.create("saas-ag.x", [{ key: "algolia_activation", value: true }]);
await client.clientConfig.update("saas-ag.x", "algolia_activation", { key: "algolia_activation", value: false });
await client.clientConfig.delete("saas-ag.x", "algolia_activation");
```

## Configuration flags

`ConfigurationDraft` accepts: `description`, `secured` (encrypts a string value
at rest), `restricted` (cannot be deleted), `readOnly` (cannot be updated),
`schemaUrl` (JSON-Schema validation; immutable once set).

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
