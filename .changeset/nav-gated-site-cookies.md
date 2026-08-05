---
"@viu/emporix-sdk-next": patch
---

`emporixSiteProxy` now emits `Set-Cookie` for `emporix.siteCode` and
`emporix.language` only on a real top-level navigation.

Before, every request that reached middleware wrote them — including a `<Link>`
prefetch. A link to another language therefore switched the visitor's language as
soon as it entered the viewport, and the session routes then rendered in a language
nobody chose. Reproduced with a real Chrome prefetch against a production build.

Detection reads `sec-fetch-mode`: `navigate` is a navigation, anything fetch-based is
not. A missing header counts as a navigation, so old clients, `curl` and bots keep
their behaviour. The forwarded request cookies are still injected either way, so even
a speculative render uses the language of the URL it was asked for.

Checking for "is this a prefetch" instead is deliberately not done: Next strips its
own router signals — `next-router-prefetch`, `rsc`, `next-router-segment-prefetch`
and the `_rsc` query parameter — before middleware runs, measured on Next 16.2.12. A
prefetch is indistinguishable there from a genuine client-side navigation.

Token rotation in `emporixTokenProxy` is deliberately **not** gated the same way: a
visitor who navigates client-side for an hour would otherwise never rotate.
