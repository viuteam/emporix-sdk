---
"@viu/emporix-sdk-react": patch
---

`usePaymentModes` now works for anonymous (guest) sessions, not only logged-in
customers. It auto-detects auth (customer token if stored, otherwise anonymous)
and the query is keyed by the resolved auth kind.
