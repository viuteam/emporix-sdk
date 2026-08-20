---
"@viu/emporix-sdk": minor
---

chore(sdk): sync generated types with upstream Emporix API specs

Updated services: ai-service

Raised from `patch` to `minor` by hand: this sync reshapes the MCP server model
rather than extending it, and a patch would not announce that.

**`McpServerResponse` is now a union.** Emporix split the single managed-MCP-server
shape into a custom and a dynamic variant:

```ts
// before
type McpServerResponse = BaseMcpServer & { … }
// after
type McpServerResponse = CustomMcpServerResponse | DynamicMcpServerResponse
```

`McpServerRequest` splits the same way. Since `client.ai.mcpServers` is typed
`AgenticCrudResource<McpServer, McpServerInput>` and `McpServer` aliases
`McpServerResponse`, code that reads fields off a returned MCP server now has to
narrow first. Nothing inside the SDK does, which is why the build stays green — the
break lands in consumer code.

Also in this sync:

- `McpServerType` gains `'dynamic'` (was `'custom' | 'predefined'`).
- `BaseMcpServer` and `CustomAgentMcpServerResponse` are gone, replaced by
  `BaseManagedMcpServer` and `AgentMcpServerResponse`.
- `AgentMcpServersResponse` changes element type to `Array<AgentMcpServerResponse>`.
- Eight new types describe MCP tool invocation: `McpToolRequest`/`Response`,
  `McpToolConfigRequest`/`Response`, `McpToolInvocationRequest`/`Response`,
  `McpToolInvocationMethod` and `McpToolInvocationArgsLocation`.

No facade change: all 57 ai-service operations were already wrapped, and none of
the removed type names appear outside the generated file.
