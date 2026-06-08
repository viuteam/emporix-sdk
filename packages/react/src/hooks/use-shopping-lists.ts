import {
  useQuery,
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
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";

const SHOPPING_LIST_STALE_TIME = 30_000;
const INVALIDATE_KEY = ["emporix", "shopping-lists"] as const;

/** The caller's shopping lists (customer-only). Optionally filtered by name. */
export function useShoppingLists(
  opts: { name?: string } = {},
): UseQueryResult<ShoppingList[]> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const { siteCode, language } = useReadSite();
  return useQuery({
    queryKey: emporixKey("shopping-lists", [opts.name ?? null], { tenant: client.tenant, authKind: ctx.kind, siteCode, language }),
    queryFn: () => client.shoppingLists.list(ctx, opts),
    staleTime: SHOPPING_LIST_STALE_TIME,
  });
}

/** Create a shopping list. */
export function useCreateShoppingList(): UseMutationResult<{ id: string }, unknown, ShoppingListDraft> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ShoppingListDraft) => client.shoppingLists.create(draft, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Delete a named list (or all the customer's lists when `name` is omitted). */
export function useDeleteShoppingList(): UseMutationResult<void, unknown, { customerId: string; name?: string }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, name }: { customerId: string; name?: string }) =>
      client.shoppingLists.delete(customerId, ctx, name !== undefined ? { name } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Add/replace an item in a list. */
export function useAddToShoppingList(): UseMutationResult<void, unknown, { customerId: string; listName: string; item: ShoppingListItem }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, item }: { customerId: string; listName: string; item: ShoppingListItem }) =>
      client.shoppingLists.addItem(customerId, listName, item, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Remove an item from a list by productId. */
export function useRemoveFromShoppingList(): UseMutationResult<void, unknown, { customerId: string; listName: string; productId: string }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, productId }: { customerId: string; listName: string; productId: string }) =>
      client.shoppingLists.removeItem(customerId, listName, productId, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Set an item's quantity (0 removes it). */
export function useSetShoppingListItemQuantity(): UseMutationResult<void, unknown, { customerId: string; listName: string; productId: string; quantity: number }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, productId, quantity }: { customerId: string; listName: string; productId: string; quantity: number }) =>
      client.shoppingLists.setItemQuantity(customerId, listName, productId, quantity, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
