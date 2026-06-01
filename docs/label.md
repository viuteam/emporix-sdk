# Label Service

Bindings for the Emporix **Label Service** (`/label/labels`): CRUD over product
labels (e.g. "Sale", "New").

> **Server-side.** Defaults to the service (clientCredentials) token
> (`label.label_read` / `label.label_manage`). The path carries no tenant
> segment — the tenant comes from the token.

```ts
const labels = await client.labels.listLabels();
const label = await client.labels.getLabel("label-id");
await client.labels.createLabel({ name: "Sale" });
await client.labels.updateLabel("label-id", { name: "Clearance" });
await client.labels.patchLabel("label-id", { name: "Renamed" });
await client.labels.deleteLabel("label-id");
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
