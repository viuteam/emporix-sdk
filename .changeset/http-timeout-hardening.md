---
"@viu/emporix-sdk": minor
---

harden the HTTP and token layers: timeouts and connection failures now throw typed `EmporixTimeoutError`/`EmporixNetworkError` (previously raw `AbortError`/`TypeError` escaped the SDK's error taxonomy); the response body read is bounded by the timeout (a stalled stream no longer hangs forever); `timeouts.connectMs` is now actually enforced as the time-to-headers budget; `/oauth/token` and anonymous-login fetches are bounded by `timeouts.readMs` (one hung token call no longer blocks every request behind the single-flight lock); `login`/`refresh`/`socialLogin`/`exchangeToken` now throw `EmporixAuthError` on a 2xx response missing `access_token` instead of fabricating an empty session; read-only POST search endpoints (`products.searchByIds`/`searchByCodes`, `price.match`/`matchByContext`, `availability.getMany`, category product search) are marked `idempotent: true` and retry on 5xx/429 again.
