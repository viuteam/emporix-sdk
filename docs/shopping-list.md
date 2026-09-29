# Shopping List

`client.shoppingLists` reads/writes the Emporix Shopping List Service —
per-customer named lists. `auth` is **required**: a logged-in customer manages
their **own** lists with their customer token; a service token (employee scope)
can act on any `customerId`.

```ts
import { auth } from "@viu/emporix-sdk";
const cust = auth.customer(customerToken);

const lists = await client.shoppingLists.list(cust);             // normalized array
await client.shoppingLists.create({ name: "wishlist" }, cust);   // → { id }
await client.shoppingLists.addItem("C1", "wishlist", { productId: "p1", quantity: 2 }, cust);
await client.shoppingLists.setItemQuantity("C1", "wishlist", "p1", 5, cust); // 0 removes
await client.shoppingLists.removeItem("C1", "wishlist", "p1", cust);
await client.shoppingLists.delete("C1", cust, { name: "wishlist" });          // omit name → all
```

The Emporix API has **no item-level CRUD**: `addItem`/`removeItem`/
`setItemQuantity` read the list and `PUT` the full body — **last-write-wins**.
The awkward per-customer wire envelope is normalized to a clean `ShoppingList[]`.

## Acting for a customer (employee)

With a service token, `list()` returns **every customer's** lists and Emporix
ignores its `name` filter. Read one customer's lists with `getForCustomer`:

```ts
const svc = auth.service();
const lists = await client.shoppingLists.getForCustomer("C1", svc);              // all of C1's lists
const [wishlist] = await client.shoppingLists.getForCustomer("C1", svc, { name: "wishlist" });
```

`addItem`, `removeItem` and `setItemQuantity` read through `getForCustomer` when
given a service token, so an employee edit starts from that customer's list. (They
used to read through `list()`, where the first list of that name could belong to
another customer — and its items were then written into this one.) A customer
token keeps reading the caller's own lists.

## React

Customer-only hooks; write mutations take `customerId` as a mutation variable
(storage holds only the token). Stale-time 30s; mutations invalidate the list query.

```tsx
import {
  useShoppingLists, useCreateShoppingList,
  useAddToShoppingList, useRemoveFromShoppingList,
  useSetShoppingListItemQuantity, useDeleteShoppingList,
} from "@viu/emporix-sdk-react";

const { data: lists } = useShoppingLists();
const add = useAddToShoppingList();
add.mutate({ customerId: "C1", listName: "wishlist", item: { productId: "p1", quantity: 2 } });
```
