import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  type ShoppingList,
  type ShoppingListItem,
  type ShoppingListDraft,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerCtxResolver } from "./internal/use-read-auth";
import { useEmporixQuery } from "./internal/use-emporix-query";

const SHOPPING_LIST_STALE_TIME = 30_000;
const INVALIDATE_KEY = ["emporix", "shopping-lists"] as const;

/**
 * The caller's shopping lists, optionally filtered by name. Disabled until a
 * customer token exists.
 */
export function useShoppingLists(
  opts: { name?: string } = {},
): UseQueryResult<ShoppingList[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "full", resource: "shopping-lists", args: [opts.name ?? null],
    queryFn: (ctx) => client.shoppingLists.list(ctx, opts),
    staleTime: SHOPPING_LIST_STALE_TIME,
  });
}

// The writes below need a signed-in customer. Without one the mutation fails;
// rendering does not, so a component guests also see can hold them.

/** Create a shopping list. */
export function useCreateShoppingList(): UseMutationResult<{ id: string }, unknown, ShoppingListDraft> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ShoppingListDraft) => client.shoppingLists.create(draft, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Delete a named list (or all the customer's lists when `name` is omitted). */
export function useDeleteShoppingList(): UseMutationResult<void, unknown, { customerId: string; name?: string }> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, name }: { customerId: string; name?: string }) =>
      client.shoppingLists.delete(customerId, customerCtx(), name !== undefined ? { name } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Add/replace an item in a list. */
export function useAddToShoppingList(): UseMutationResult<void, unknown, { customerId: string; listName: string; item: ShoppingListItem }> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, item }: { customerId: string; listName: string; item: ShoppingListItem }) =>
      client.shoppingLists.addItem(customerId, listName, item, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Remove an item from a list by productId. */
export function useRemoveFromShoppingList(): UseMutationResult<void, unknown, { customerId: string; listName: string; productId: string }> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, productId }: { customerId: string; listName: string; productId: string }) =>
      client.shoppingLists.removeItem(customerId, listName, productId, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Set an item's quantity (0 removes it). */
export function useSetShoppingListItemQuantity(): UseMutationResult<void, unknown, { customerId: string; listName: string; productId: string; quantity: number }> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, productId, quantity }: { customerId: string; listName: string; productId: string; quantity: number }) =>
      client.shoppingLists.setItemQuantity(customerId, listName, productId, quantity, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
