---
"@viu/emporix-sdk-next": minor
---

Initial release. Next.js server-side bindings for the Emporix SDK.

- `getEmporixClient()` — a memoized `EmporixClient` per process (never per
  request) whose `fetch` attaches Next cache tags to cacheable catalog GETs.
  `getEmporixClient({ tagged: false })` is the untagged variant and is required
  for anything carrying a customer token: Next's fetch cache does not key on the
  `Authorization` header, and the wrapper cannot tell an anonymous from a
  customer request.
- `emporixSession()` / `emporixSessionMutable()` — the Emporix session from
  `next/headers` cookies, read-only for Server Components and read-write with
  `httpOnly`/`secure`/`lax` defaults for Server Actions and Route Handlers.
- `emporixTags` / `emporixTagsForUrl` — the tag vocabulary and the URL mapping.
  Tags are derived centrally from the request URL rather than passed per call,
  because the SDK has 596 request call sites.
- `@viu/emporix-sdk-next/webhook` — `verifyEmporixSignature`, `canonicalJson` and
  `createEmporixWebhookRoute`, which revalidates the affected tags. The signature
  is HMAC-SHA256 base64 over the **canonically re-serialized** body (keys sorted,
  nested included), matching Emporix's documented example — a verifier written
  against the raw bytes rejects every real delivery. Not yet verified against live
  traffic; smoke-test one delivery, and pass `canonicalize: false` if your tenant
  signs raw bytes.

Requires `@viu/emporix-sdk` with `EmporixConfig.fetch`. No runtime dependencies.
