---
"@viu/emporix-sdk": minor
---

Fix the JSON-Patch `op` enum for the Approval service. The upstream spec ships
`ADD`/`REMOVE`/`REPLACE`, which the live API rejects with 400; `ApprovalPatch['op']`
is now `'add' | 'remove' | 'replace'`. Callers that worked around the wrong type
with a cast can drop it. Measured against tenant `viu` on 2026-08-18.
