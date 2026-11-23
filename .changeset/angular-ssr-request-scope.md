---
"@viu/emporix-sdk-angular": minor
---

fix(angular): keep one visitor's session out of the next server-rendered request

Under `@angular/ssr` the server imports `appConfig` once and bootstraps a new application from it for every request. `provideEmporix` used to build its storage fallback, query cache, site state and company state when it was called, so every request shared them. In a server render one customer's profile and cart showed up in the next customer's HTML without a call to Emporix, and a guest's render saw the previous customer's token.

- **Per application.** `provideEmporix` now builds that state in provider factories, once per application injector. In the browser nothing changes.
- **Factories.** `client`, `storage` and `queryClient` also accept a factory that runs once per application, in its injection context, so a storage can be built from `inject(REQUEST)`. The documented setup now passes factories.
- **Server guard.** On the server, `provideEmporix` throws when a `client`, `storage` or `queryClient` instance already serves another application. The anonymous session lives on the client, and Emporix binds a guest cart to it, so a shared client gives every guest the same cart. Pass factories when you render on the server.
- **Guest session.** The client's anonymous session is now kept in the storage, as the React provider does, so a guest cart survives a reload.

The query defaults are applied when the application injector is built rather than when `provideEmporix` is called. See "Server-side rendering" in `docs/angular.md`.
