---
"@viu/emporix-sdk": major
---

feat(sdk): send the chat session from `chat` and `chatAsync` — options second, auth third

**Breaking: `client.ai.chat(input, auth)` and `client.ai.chatAsync(input, auth)`
are now `(input, opts, auth)`**, the order `chatStream` already used.
`opts.sessionId` is sent as the `session-id` header.

Until now only `chatStream` could send that header, so a synchronous or
asynchronous chat could neither continue a conversation (continuity needs the
header plus `enabledMemory` on the agent) nor use an attachment, which the
service resolves inside the session its upload or reuse returned. The chat body
has no `sessionId` field; the header is the only way.

**Migrating:** `chat(input)` and `chatAsync(input)` are unchanged. A call that
passes an auth context second becomes `chat(input, {}, auth)`. Passing it second
now **throws** (`pass the auth context third`) instead of being read as options
— which in plain JavaScript would have run the call on the default service token
without a word. `chatStream` refuses the same mistake.

`ChatOptions` is the new shared options type; `ChatStreamOptions` remains as a
deprecated alias of it.
