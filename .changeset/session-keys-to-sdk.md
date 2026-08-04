---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": patch
"@viu/emporix-sdk-next": patch
---

Move the eight session keys into the core SDK: `STORAGE_KEYS` and
`EmporixStorageKey` are now exported from `@viu/emporix-sdk`.

They were never a React concern. The same eight strings are cookie names in a
Next `proxy.ts`, Web Storage keys in a browser adapter, and record fields in a
server-side session store — but they lived in `@viu/emporix-sdk-react`, which is
why `@viu/emporix-sdk-next` depended on the React bindings to name a cookie. Six
of the seven files in that package imported nothing else from it.

Nothing to change in your code. `@viu/emporix-sdk-react` re-exports both from
`./storage` and `/ssr`, and `@viu/emporix-sdk-next` still re-exports
`STORAGE_KEYS` from `/session`. There is exactly one definition, and a test
asserts object identity across all three paths — a copy would be the one drift
that silently breaks a session by writing a cookie under one name and reading it
under another.

Measured on the built output: `@viu/emporix-sdk-next` reached for
`@viu/emporix-sdk-react` in seven places before, and now does so in one —
`server-session.ts`, for `createServerStorage`, `serverAuth` and the
`EmporixStorage` type. Removing that last one (and the peer dependency with it) is
a follow-up, because it touches a public signature.
