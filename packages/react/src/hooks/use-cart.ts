import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Cart,
  type CartAddress,
  type CartItemInput,
  type CartItemUpdate,
  type CartCreated,
  type CreateCartInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { type QueryOpts } from "./internal/use-read-auth";

/** Fetches a cart by id. Disabled when `cartId` is undefined. */
export function useCart(cartId?: string, options: QueryOpts = {}): UseQueryResult<Cart> {
  const { client, storage } = useEmporix();
  const override = options.auth;
  const token = storage.getCustomerToken();
  const ctx: AuthContext = override ?? (token ? auth.customer(token) : auth.anonymous());
  return useQuery({
    queryKey: ["emporix", "cart", cartId ?? null, { tenant: client.tenant, authKind: ctx.kind }],
    enabled: cartId !== undefined,
    queryFn: () => client.carts.get(cartId as string, ctx),
  });
}

type Mut<TVars> = UseMutationResult<Cart, unknown, TVars, { previous: Cart | undefined }>;

/** Cart write operations with optimistic cache updates and rollback. */
export interface CartMutationsApi {
  addItem: Mut<CartItemInput>;
  updateItem: Mut<{ itemId: string; patch: CartItemUpdate }>;
  removeItem: Mut<{ itemId: string }>;
  clear: Mut<void>;
  applyCoupon: Mut<{ code: string }>;
  removeCoupon: Mut<{ code: string }>;
  setShippingAddress: Mut<CartAddress>;
  setBillingAddress: Mut<CartAddress>;
}

/** Returns mutation handles for a cart, each optimistically patching `useCart`. */
export function useCartMutations(cartId: string): CartMutationsApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const token = storage.getCustomerToken();
  const ctx: AuthContext = token ? auth.customer(token) : auth.anonymous();
  const key = ["emporix", "cart", cartId, { tenant: client.tenant, authKind: ctx.kind }];

  function make<TVars>(
    run: (vars: TVars) => Promise<Cart>,
    optimistic?: (prev: Cart | undefined, vars: TVars) => Cart | undefined,
  ): Mut<TVars> {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMutation<Cart, unknown, TVars, { previous: Cart | undefined }>({
      mutationFn: run,
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Cart>(key);
        if (optimistic) qc.setQueryData<Cart>(key, optimistic(previous, vars));
        return { previous };
      },
      onError: (_e, _v, c) => {
        if (c) qc.setQueryData(key, c.previous);
      },
      onSuccess: (cart) => qc.setQueryData(key, cart),
    });
  }

  return {
    addItem: make(
      (v) => client.carts.addItem(cartId, v, ctx),
      (prev, v) =>
        prev
          ? {
              ...prev,
              // Optimistic placeholder; replaced by the real item on success.
              items: [
                ...(prev.items ?? []),
                {
                  id: `optimistic-${v.product?.id ?? "item"}`,
                  ...v,
                } as unknown as NonNullable<Cart["items"]>[number],
              ],
            }
          : prev,
    ),
    updateItem: make((v) => client.carts.updateItem(cartId, v.itemId, v.patch, ctx)),
    removeItem: make(
      (v) => client.carts.removeItem(cartId, v.itemId, ctx),
      (prev, v) =>
        prev ? { ...prev, items: (prev.items ?? []).filter((i) => i.id !== v.itemId) } : prev,
    ),
    clear: make(
      () => client.carts.clear(cartId, ctx),
      (prev) => (prev ? { ...prev, items: [] } : prev),
    ),
    applyCoupon: make((v) => client.carts.applyCoupon(cartId, v.code, ctx)),
    removeCoupon: make((v) => client.carts.removeCoupon(cartId, v.code, ctx)),
    setShippingAddress: make((v) => client.carts.setShippingAddress(cartId, v, ctx)),
    setBillingAddress: make((v) => client.carts.setBillingAddress(cartId, v, ctx)),
  };
}

/**
 * Creates a cart. Auto-detects auth (customer if a token is stored, else
 * anonymous). On success, persists `cartId` via `storage.setCartId` so a later
 * page reload can resume the same cart with the same anonymous session.
 *
 * Note: the SDK's `carts.create` returns `CartCreated = { cartId, yrn }`, not
 * the full `Cart`. The full cart is loaded on demand by `useCart(cartId)`.
 */
export function useCreateCart(): UseMutationResult<
  CartCreated,
  unknown,
  CreateCartInput | undefined
> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  const ctx: AuthContext = token ? auth.customer(token) : auth.anonymous();
  return useMutation<CartCreated, unknown, CreateCartInput | undefined>({
    mutationFn: (input) => client.carts.create(input, ctx),
    onSuccess: (cart) => {
      if (cart.cartId) storage.setCartId(cart.cartId);
    },
  });
}
