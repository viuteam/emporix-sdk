---
"@viu/emporix-sdk-react": patch
---

Internal cleanup: drop the redundant `authKind` field from `useReadAuth`'s
return type and from `bootstrapCart`'s parameter list. Both duplicated
`ctx.kind` (the discriminator of `AuthContext`) — callers now compose
`ctx.kind` directly into query keys.

No public API changes. No cache-key shape changes (`authKind` values stay
identical: `"customer"`, `"anonymous"`, etc.). All 151 React tests stay
green.
