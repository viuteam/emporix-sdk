---
"@viu/emporix-sdk": minor
---

Add AI RAG Indexer binding: `client.ragIndexer` exposes `ragMetadata()` and
`filterMetadata()` to discover the indexed embedding / filterable fields, plus
`reindex()` to trigger a full asynchronous index rebuild. Server-side only —
these use the service (clientCredentials) token (`ai.agent_read` /
`ai.agent_manage`) and must not be called from a browser.
