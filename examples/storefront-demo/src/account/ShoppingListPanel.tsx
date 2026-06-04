import { useState } from "react";
import type { FormEvent } from "react";
import type { ShoppingList } from "@viu/emporix-sdk";
import {
  useAddToShoppingList,
  useRemoveFromShoppingList,
  useSetShoppingListItemQuantity,
  useDeleteShoppingList,
} from "@viu/emporix-sdk-react";
import { useProductNames } from "../lib/useProductNames";
import { Button } from "../components/ui/Button";
import { useToast, errorMessage } from "../app/Toasts";

type ReadItem = { productId: string; quantity: number };

/**
 * Manages one shopping list: item quantities, removal, adding a product by id
 * (a storefront would add from the PDP — by-id keeps the demo self-contained),
 * and deleting the whole list. List ops are keyed by `customerId` + list name.
 */
export function ShoppingListPanel({ customerId, list }: { customerId: string; list: ShoppingList }) {
  const setQty = useSetShoppingListItemQuantity();
  const removeItem = useRemoveFromShoppingList();
  const addItem = useAddToShoppingList();
  const del = useDeleteShoppingList();
  const { notify } = useToast();

  const items = (list.items ?? []) as ReadItem[];
  const names = useProductNames(items.map((i) => i.productId));
  const [newId, setNewId] = useState("");

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      notify(ok, "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    const productId = newId.trim();
    if (!productId) return;
    await run(
      addItem.mutateAsync({ customerId, listName: list.name, item: { productId, quantity: 1 } }),
      "Added to list",
    );
    setNewId("");
  }

  return (
    <div className="surface" style={{ padding: "var(--s-5)" }}>
      <div className="cluster" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 className="serif" style={{ fontSize: "var(--step-1)" }}>{list.name}</h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={del.isPending}
          onClick={() => void run(del.mutateAsync({ customerId, name: list.name }), "List deleted")}
        >
          Delete list
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--step--1)", marginTop: "var(--s-3)" }}>This list is empty.</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, gap: "var(--s-2)", marginTop: "var(--s-3)" }}>
          {items.map((i) => (
            <li key={i.productId} className="cluster" style={{ justifyContent: "space-between", gap: "var(--s-4)" }}>
              <span style={{ flex: 1 }}>{names[i.productId] ?? i.productId}</span>
              <div className="qty" role="group" aria-label="Quantity">
                <button type="button" aria-label="Decrease" onClick={() => void run(setQty.mutateAsync({ customerId, listName: list.name, productId: i.productId, quantity: i.quantity - 1 }), "Updated")}>–</button>
                <span>{i.quantity}</span>
                <button type="button" aria-label="Increase" onClick={() => void run(setQty.mutateAsync({ customerId, listName: list.name, productId: i.productId, quantity: i.quantity + 1 }), "Updated")}>+</button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void run(removeItem.mutateAsync({ customerId, listName: list.name, productId: i.productId }), "Removed")}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="cluster" style={{ gap: "var(--s-2)", marginTop: "var(--s-4)" }}>
        <input
          className="input"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          placeholder="Add product by ID"
          aria-label="Product ID"
          style={{ flex: 1 }}
        />
        <Button type="submit" variant="outline" size="sm" disabled={addItem.isPending}>Add</Button>
      </form>
    </div>
  );
}
