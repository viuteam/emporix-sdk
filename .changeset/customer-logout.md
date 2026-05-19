---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add real customer logout. `customers.logout(auth)` calls
`GET /customer/{tenant}/logout?accessToken=…` authorized with the customer
token, invalidating it server-side (204). `useCustomerSession().logout()` is
now async: it performs the server logout best-effort (ignoring failures, e.g.
an already-expired token) and then clears the local session. The token is
sent only as a query param the SDK never logs (the logger uses the path, not
the full URL).
