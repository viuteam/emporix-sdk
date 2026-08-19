---
"@viu/emporix-sdk": patch
---

Warn when `context` is passed at the top level of `EmporixConfig` instead of inside
`credentials.storefront`. It was silently dropped, after which `matchByContext`
returns an empty list with no error because the anonymous token carries no site,
currency or country. `logger: false` is honoured as a request for silence.
