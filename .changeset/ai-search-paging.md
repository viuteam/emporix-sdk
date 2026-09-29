---
"@viu/emporix-sdk": minor
---

feat(sdk): send paging, sort and fields on every AI search

The ten AI search methods — `searchAgents`, `searchConversations`, `search` on `tools`, `mcpServers`, `tokens`, `oauths`, `templates` and `jobs`, and `logs.searchRequests` / `logs.searchSessions` — sent their input as the request body only. Emporix reads paging, sort and fields from the query string, so every search returned the server's first page with no way to reach the rest.

They now take `pageNumber`, `pageSize`, `sort` and `fields` next to `q` (the new `SearchPaging` type) and send them as query parameters; `q` stays in the body. A call without them goes out exactly as before.
