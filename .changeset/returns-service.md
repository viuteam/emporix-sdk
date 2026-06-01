---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Returns Service bindings via `client.returns`: CRUD over returns
(`listReturns`, `getReturn`, `createReturn`, `updateReturn`, `patchReturn`,
`deleteReturn`). Methods default to the service token and are auth-overridable;
`patchReturn` takes a JSON-Patch op-array. Adds React hooks `useMyReturns`,
`useReturn`, and `useCreateReturn` for customer self-service (browser customer
token).
