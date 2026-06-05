# Cloud Functions

Invoke tenant-hosted [Emporix cloud functions](https://developer.emporix.io/ce/extensibility-and-integrations/extensibility-cases/extension-hosting)
from the SDK or React. Request and response bodies are **whatever your function
returns** — the API is generic (`<TRes, TReq>`), not schema-generated.

Endpoint: `/cloud-functions/{tenant}/functions/{functionId}[/sub-path]`. Methods:
`GET`, `POST` (default), `PUT`, `DELETE`. Auth: `service`, `customer`,
`anonymous`, or `raw` — the platform validates the token; you don't validate it
inside the function.

## SDK

```ts
// POST {} → returns the function's JSON, typed by you
const res = await client.cloudFunctions.invoke<{ greeting: string }>(
  "23eef339-6e55-4849-b884-b6643ad01406",
  { body: { name: "John" } },               // method defaults to POST
);

// GET a read-style function with a sub-path + query, as a customer
const list = await client.cloudFunctions.invoke<Product[]>(
  fnId,
  { method: "GET", path: "products", query: { page: 2 } },
  auth.customer(token),
);

// Service-account call (Node/backend only — never ship service creds to a browser)
await client.cloudFunctions.invoke(fnId, { body: payload }, auth.service());
```

`invoke<TRes, TReq>(functionId, options?, auth?)`:

| Option | Default | Notes |
|---|---|---|
| `method` | `"POST"` | `GET` / `POST` / `PUT` / `DELETE` |
| `path` | — | sub-path the function exposes (leading slash optional) |
| `body` | — | arbitrary JSON request |
| `query` | — | query-string params |
| `headers` | — | extra headers (`Content-Type: application/json` is default) |
| `auth` (3rd arg) | `auth.anonymous()` | `auth.service()` / `auth.customer(token)` / `auth.raw(token)` |

A non-2xx response throws the typed `EmporixError` subclasses (e.g. 403 →
`EmporixInsufficientScopeError`); an empty `204` resolves to `undefined`.

## React

Auth resolves automatically — **customer** if a token is stored, else
**anonymous** — with an optional `auth` override. Service auth is not exposed in
React (no secrets in a storefront bundle); pass `auth: auth.raw(token)` if you
hold a token yourself.

```tsx
// Imperative (any method)
const invoke = useInvokeCloudFunction<{ greeting: string }>();
await invoke.mutateAsync({ functionId: fnId, body: { name: "John" } });

// Read-style with caching (GET, disabled until functionId is set)
const { data, isLoading } = useCloudFunction<Product[]>(fnId, {
  path: "products",
  query: { page: 2 },
});
```
