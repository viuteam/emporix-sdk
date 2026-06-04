import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ShoppingList } from "@viu/emporix-sdk";
import { useCustomerSession, useShoppingLists, useCreateShoppingList } from "@viu/emporix-sdk-react";
import { ShoppingListPanel } from "../../account/ShoppingListPanel";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast, errorMessage } from "../../app/Toasts";
import { RequireAuth } from "./RequireAuth";

export function Lists() {
  return (
    <RequireAuth>
      <ListsInner />
    </RequireAuth>
  );
}

function ListsInner() {
  const { customer } = useCustomerSession();
  const customerId = (customer as { id?: string } | null)?.id ?? "";
  const { data, isLoading } = useShoppingLists();
  const create = useCreateShoppingList();
  const { notify } = useToast();
  const lists = (data ?? []) as ShoppingList[];
  const [name, setName] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      await create.mutateAsync({ name: n, items: [] });
      notify("List created", "success");
      setName("");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)", maxWidth: "44rem" }}>
      <Link to="/account" className="u-underline muted" style={{ fontSize: "var(--step--1)" }}>← Account</Link>
      <h2 className="serif" style={{ marginBlock: "var(--s-3) var(--s-5)" }}>Shopping lists</h2>

      <form onSubmit={add} className="cluster surface" style={{ gap: "var(--s-3)", padding: "var(--s-4)", alignItems: "end" }}>
        <Field label="New list name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wishlist" />
        <Button type="submit" variant="solid" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create"}
        </Button>
      </form>

      <div className="stack" style={{ gap: "var(--s-4)", marginTop: "var(--s-5)" }}>
        {isLoading ? (
          <Loading label="Loading lists" />
        ) : lists.length === 0 ? (
          <EmptyState title="No lists yet">Create one above to start curating.</EmptyState>
        ) : (
          lists.map((l) => <ShoppingListPanel key={l.key ?? l.name} customerId={customerId} list={l} />)
        )}
      </div>
    </div>
  );
}
