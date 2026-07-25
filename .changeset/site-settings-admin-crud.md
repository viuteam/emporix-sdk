---
"@viu/emporix-sdk": minor
---

Add site-settings admin operations to `client.sites`: `create`, `update`
(PATCH), `replace` (PUT, with an optional `expand` query), `delete`,
`listCodes` (GET `/siteslist`), and a `sites.mixins` sub-resource
(`list`/`get`/`create`/`update`/`replace`/`delete`). Writes default to service
auth. `update`/`replace` return nothing — those endpoints respond 200 without a
defined body, so re-read with `get(siteCode)` when the updated site is needed.
The existing reads are unchanged.
