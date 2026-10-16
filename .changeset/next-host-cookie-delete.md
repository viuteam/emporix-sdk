---
"@viu/emporix-sdk-next": patch
---

fix(core): delete __Host- session cookies with the attributes they were written with

Over HTTPS the session cookies are named with the `__Host-` prefix, and a browser accepts a `__Host-` `Set-Cookie` only with `Secure` and `Path=/` — the deleting one included. The package deleted them with `cookies().delete(name)`, which sends `Path=/` and an expired date but no `Secure`, so the browser ignored the deletion and the cookie stayed. A cart id outlived its order, the anonymous session and the store-mode `emporix.sid` survived `destroy()`, and a `null` write through `emporixSessionMutable` left the value in place. Every deletion now carries the same attributes as the write. Plain-http hosts, where the cookies have no prefix, were not affected.
