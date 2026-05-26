---
"@viu/emporix-sdk": minor
---

Expose B2B services as subpath imports: `@viu/emporix-sdk/companies`, `@viu/emporix-sdk/contacts`, `@viu/emporix-sdk/locations`, `@viu/emporix-sdk/customer-groups`. The services were already reachable via the package root; this adds the matching `exports` entries and `tsup` build artefacts so tree-shaking and selective imports work the same way they do for `./customer`, `./product`, etc.
