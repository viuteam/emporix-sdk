# Cart

Most cart operations are documented where they are used: the storefront flow in
[checkout.md](./checkout.md), the React hooks in [react.md](./react.md), the
Angular bindings in [angular.md](./angular.md). This page covers the one cart
feature with enough behaviour of its own to need a page: command chains.

## Command chains (`carts.execute`)

`POST /cart/{tenant}/carts/{cartId}/execute` runs up to ten existing cart
operations on one cart, in order, in a single request. The typical chain adds an
item and reads the calculated cart back — one round trip instead of two:

```ts
import { auth, type Cart } from "@viu/emporix-sdk";

const { results } = await client.carts.execute(
  cartId,
  [
    {
      type: "AddCartItem",
      data: {
        itemYrn: "urn:yaas:saasag:caasproduct:product:acme;p1",
        quantity: 2,
        price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "CHF" },
      },
    },
    { type: "GetCart" },
  ],
  auth.anonymous(),
);
const cart = results.at(-1)?.data as Cart | undefined; // the GetCart result
```

Each command has a `type`, the equivalent REST call's body as `data`, and its
remaining path and query parameters as `options` (`itemId`, `partial`,
`expandCalculation`, `zipCode`, `countryCode`, `resourceVersion`, `codes`,
`discountIndex`). The cart id is the path parameter of `execute`, never a
command field. `CartCommand` types `data` per command:

| Command | `data` |
|---|---|
| `AddCartItem` | `CartItemInput` |
| `UpdateCartItem` | `CartItemUpdate` (`options.itemId` required, `options.partial` for a partial update) |
| `AddCartItemsBatch` | `CartItemInput[]` |
| `UpdateCartItemsBatch` | `CartItemsBatchUpdateInput` (at most 50) |
| `UpdateCart` | `CartUpdateInput` |
| `ApplyCartDiscount` | `CartDiscountInput` |
| `DeleteCartItem` (`options.itemId`), `DeleteCartItems`, `GetCart`, `GetCartDiscounts`, `DeleteCartDiscounts` (`options.codes`), `DeleteCartDiscount` (`options.discountIndex`), `RefreshCart`, `ValidateCart` | none |

### Options

| Option | Values | Effect |
|---|---|---|
| `onError` | `"fail"` (default), `"resume"` | `fail` stops after the first command that does not answer 2xx; `resume` runs every command, and later ones see the earlier successful writes |
| `versioning` | `"skip"` (default), `"explicit"`, `"follow"` | If-Match for `AddCartItem`, `UpdateCartItem`, `UpdateCart`, `ApplyCartDiscount`: `explicit` requires `options.resourceVersion` on each of them (checked before anything runs); `follow` seeds from the first one and carries the version on |

```ts
await client.carts.execute(cartId, commands, auth.customer(token), {
  onError: "resume",
  versioning: "follow",
});
```

### Results and errors

The response is `207` with one result per command that ran:
`{ index, type, code, status, data?, headers? }`. `data` is what the equivalent
REST call would have returned — the cart for `GetCart`, `{ itemId, yrn }` for
`AddCartItem`, nothing for a `204` — or that call's error body.

- **`onError: "fail"`** — `execute` **throws** the error the failed command's
  REST call would have thrown: an `EmporixNotFoundError` for a 404, an
  `EmporixValidationError` for a 400, … with the command's error body as
  `error.body`. The message names the command's index and type.
- **`onError: "resume"`** — `execute` resolves with every result, failed ones
  included. Check each `code`.
- **A `400` for the whole request** (no commands or more than ten, an unknown
  type, a bad option value, a missing `resourceVersion` under `explicit`) throws
  an `EmporixValidationError`, and **no command ran**.

### Traps

| Trap | What to do |
|---|---|
| Commands before a failed one **have been applied** | Treat a failure as «the cart changed» and re-read it. The React and Angular bindings do this for you |
| The request takes about as long as its commands together | Size the client's `timeouts.readMs` for your longest chain; a timeout does not mean nothing was written |
| `execute` is **never retried** on a 5xx | Deliberate: a replay would apply the writes twice |
| A `GetCart` followed by another write returns a cart that is already stale | End the chain with `GetCart` when you want the final cart |
| `session-id` and `legal-entity-id` headers apply to the whole chain | The SDK sends neither, like its other cart calls; to act as another legal entity, send another request |

### Auth and scopes

A customer or anonymous token works on the shopper's own cart. A service token
works on any cart and needs `cart.cart_manage`; a command carrying an external
price, product, fee or discount additionally needs
`cart.cart_manage_external_prices`.
