---
"@viu/emporix-sdk": minor
---

feat(sdk): page listAgents and listConversations

Both took only `auth`, so they returned the server's first page with no way to reach the rest. They now take a query first — `q`, `pageNumber`, `pageSize`, `sort`, `fields`, and for agents `expand` — like every other AI list method: `listAgents({ pageNumber: 2 }, auth)`. The original `listAgents(auth)` still works: an auth context in the first position is recognised and never sent as query parameters.
