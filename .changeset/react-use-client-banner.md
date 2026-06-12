---
"@viu/emporix-sdk-react": patch
---

ship a `"use client"` directive in the built client entries (`.`, `./provider`, `./hooks`, `./storage`) so they load as Client Components under the Next.js App Router without every consumer having to add their own `"use client"` wrapper file. `./ssr` stays directive-free and remains importable from Server Components — in server code, import `prefetchProduct`/`prefetchCart`/`prefetchOrder` from `@viu/emporix-sdk-react/ssr`, not from the package root.
