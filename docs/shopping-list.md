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
