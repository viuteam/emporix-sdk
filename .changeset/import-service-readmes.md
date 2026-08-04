---
"@viu/emporix-sdk-next": patch
"@viu/emporix-sdk-react": patch
---

Document the new import service in both package READMEs, which ship in the npm
tarballs.

`@viu/emporix-sdk-next` gains a Route Handler that re-emits
`client.imports.streamRun(runId)` as Server-Sent Events to the browser, including
the abort-on-disconnect line and why this is Node runtime only. No package code
changed: `getEmporixServiceClient` needs no per-service registration, and cache
tags have nothing to add for a service whose reads are not cacheable.

`@viu/emporix-sdk-react` states why admin-only services have no hooks, with the
import service as the clearest case — every operation needs client-credentials
with the `importtool.import_trigger` scope, and the provider is configured with a
public storefront client id.
