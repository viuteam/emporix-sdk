---
"@viu/emporix-sdk": minor
---

feat(sdk): expose new Emporix endpoints and add SSE streaming

From the 2026-07 upstream sync:

- `ai.chatStream(input, { sessionId })` — streaming agent chat over Server-Sent
  Events; yields each SSE `data` payload.
- `ai.listConversations()` / `ai.searchConversations({ q })`.
- `category.rebuildTree(rootCategoryId)`.
- `schema.bulkPatchInstances(type, items)` — bulk PATCH (207 per-item results).
- New core capability `HttpClient.requestStream` for `text/event-stream` responses.
