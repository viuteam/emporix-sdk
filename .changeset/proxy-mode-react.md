---
"@viu/emporix-sdk-react": minor
---

feat(react): run the provider behind a Backend for Frontend with `customerSession: "proxy"`

`EmporixProvider` gains a third session mode, `"proxy"`, for a client built with the SDK's new `proxy` option. It is the default for such a client. The app passes what its Backend for Frontend says about the session in `proxySession={{ authenticated, login, logout }}`.

In this mode:

- **Hooks.** Customer hooks take their customer paths while `authenticated` is true. They use `PROXY_CUSTOMER_TOKEN`, a marker that is never sent.
- **Storage.** No token is ever written to `storage`. The provider puts a view in front of it whose token slots stay empty, while cart id, site, language and legal entity pass through.
- **Session work in the browser.** No anonymous session is stored, no customer token is refreshed, and no company context is bootstrapped.
- **401s.** `onCustomerSessionExpired` fires on every 401 the proxy answers.
- **`useCustomerSession`.** `login` and `logout` call `proxySession.login` / `.logout`, and reject without them. `socialLogin`, `exchangeToken` and `refreshSession` reject, and so does `useConfirmSignup`: each would put a customer token into the browser.

Configuration mistakes fail the first render: `"proxy"` without a proxy-mode client, another mode with one, or `initialCustomerToken` / `autoRefreshCustomerToken` together with `"proxy"`. The `"owned"` and `"external"` modes are unchanged. See `docs/bff.md`.
