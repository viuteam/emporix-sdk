---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Raise Node.js engines floor from `>=18` to `>=20.19.0`. Node 18 reached end-of-life on 30 April 2025; Node 20 LTS (≥ 20.19.0, which ships flag-free `require(esm)`) is the new minimum. Development happens on Node 24 LTS (`.nvmrc` updated); CI exercises Node 20, 22, and 24.

No code changes — no SDK feature uses a Node API beyond what Node 20 provides. Browser consumers are unaffected.
