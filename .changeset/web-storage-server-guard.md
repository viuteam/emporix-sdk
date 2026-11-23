---
"@viu/emporix-sdk": patch
---

fix(sdk): keep web storage off servers that define it

`createSessionStorage()` and `createLocalStorage()` now use Web Storage only where there is a `document`, and fall back to memory everywhere else.

Node 26 defines a `sessionStorage` on the server that the whole process shares. So does Node started with `--localstorage-file` for `localStorage`, and Deno. Before this fix, the storage backends wrote into that store on such a server, so requests could share a customer token. During server-side rendering the React provider seeds `initialCustomerToken` into the storage, which made this reachable. On Node 26 the backends also no longer trigger Node's `localStorage is not available` warning.

Browsers are unchanged. `@viu/emporix-sdk-react`, `-angular` and `-next` get the fix through their dependency on the SDK.
