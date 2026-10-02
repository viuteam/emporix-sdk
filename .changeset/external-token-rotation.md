---
"@viu/emporix-sdk-react": patch
---

Stop a changed `initialCustomerToken` from updating components mid-render.

With `customerSession="external"`, changing `initialCustomerToken` after mount
made React log «Cannot update a component while rendering a different
component», with or without `onTelemetry`. The provider wrote the new token to
storage during its own render, and storage notifies synchronously, so every
component reading the token, and an `onTelemetry` handler that sets state on the
`storage.write` event, was updated in the middle of that render. In owned mode,
a token seeding a slot that a logout had emptied did the same.

The first seed into a storage still happens during the render, so the children's
first render is authenticated. Any later change is written in a layout effect,
after the render and before paint.

In external mode the hooks now read the token from the prop rather than from
storage, so the render that changes it already sends the new one. Reading
storage there, a host that switches tenant and token in one render would have
had every query send the previous token to the new tenant. While the prop is
set, a token written to storage from inside the tree, by `useCustomerSession`'s
`login` or `logout` for instance, no longer reaches the hooks.
