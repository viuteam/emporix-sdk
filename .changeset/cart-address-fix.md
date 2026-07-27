---
"@viu/emporix-sdk": minor
---

Fix `carts.setShippingAddress` and `carts.setBillingAddress`, which called
`/carts/{id}/shipping-address` and `/carts/{id}/billing-address` — paths that do
not exist and returned 404 on every call (verified against a live tenant). Cart
addresses are set through `PUT /carts/{id}` with an `addresses` array. Because
that array is a full replace — sending one type leaves the other as an empty
stub — both methods now read the cart, merge in the new address, write, and
return the re-fetched cart. Their signatures are unchanged.

Adds `carts.setAddresses(cartId, { shipping, billing }, auth)` for setting both
in a single request, skipping the read. Note it **replaces** the address set: an
omitted type is cleared.
