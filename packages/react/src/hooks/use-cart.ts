import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  EmporixError,
  type AuthContext,
  type Cart,
  type CartAddress,
  type CartItemInput,
  type CartItemUpdate,
  type CartCreated,
  type CreateCartInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

/** Fetches a cart by id. Falls back to `storage.getCartId()` when no argument is passed; disabled when neither is set. */
export function useCart(cartId?: string, options: QueryOpts = {}): UseQueryResult<Cart> {
  const { client, storage } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const resolvedId = cartId ?? storage.getCartId() ?? undefined;
  return useQuery({
    queryKey: ["emporix", "cart", resolvedId ?? null, { tenant: client.tenant, authKind: kind }],
    enabled: resolvedId !== undefined,
    queryFn: () => client.carts.get(resolvedId as string, ctx),
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

/**
 * Cart write operations with optimistic cache updates and rollback.
 *
 * `cartId` is optional — when omitted, `storage.getCartId()` is resolved at
 * **mutate-time** (inside `mutationFn`/`onMutate`), so post-mount writes from
 * `useActiveCart({ create: true })` work without a render race. Throws
 * `EmporixError("useCartMutations: no cartId available — …")` when storage
 * is still empty at mutate-time.
 */
export function useCartMutations(cartId?: string): CartMutationsApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const { ctx, kind } = useReadAuth();

  const resolveId = (): string => {
    const id = cartId ?? storage.getCartId();
    if (!id) {
      throw new EmporixError(
        "useCartMutations: no cartId available — pass one explicitly or call useActiveCart({ create: true }) first",
      );
    }
    return id;
  };
  const keyFor = (id: string) =>
    ["emporix", "cart", id, { tenant: client.tenant, authKind: kind }] as const;

  function make<TVars>(
    run: (id: string, vars: TVars) => Promise<Cart>,
    optimistic?: (prev: Cart | undefined, vars: TVars) => Cart | undefined,
  ): Mut<TVars> {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMutation<
      Cart,
      unknown,
      TVars,
      { previous: Cart | undefined; key: readonly unknown[] }
    >({
      mutationFn: async (vars) => run(resolveId(), vars),
      onMutate: async (vars) => {
        const id = resolveId();
        const key = keyFor(id);
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Cart>(key);
        if (optimistic) qc.setQueryData<Cart>(key, optimistic(previous, vars));
        return { previous, key };
      },
      onError: (_e, _v, c) => {
        if (c) qc.setQueryData(c.key, c.previous);
      },
      onSuccess: (cart, _v, c) => {
        if (c) qc.setQueryData(c.key, cart);
      },
    });
  }

  return {
    addItem: make(
      (id, v) => client.carts.addItem(id, v, ctx),
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
    updateItem: make((id, v) => client.carts.updateItem(id, v.itemId, v.patch, ctx)),
    removeItem: make(
      (id, v) => client.carts.removeItem(id, v.itemId, ctx),
      (prev, v) =>
        prev ? { ...prev, items: (prev.items ?? []).filter((i) => i.id !== v.itemId) } : prev,
    ),
    clear: make(
      (id) => client.carts.clear(id, ctx),
      (prev) => (prev ? { ...prev, items: [] } : prev),
    ),
    applyCoupon: make((id, v) => client.carts.applyCoupon(id, v.code, ctx)),
    removeCoupon: make((id, v) => client.carts.removeCoupon(id, v.code, ctx)),
    setShippingAddress: make((id, v) => client.carts.setShippingAddress(id, v, ctx)),
    setBillingAddress: make((id, v) => client.carts.setBillingAddress(id, v, ctx)),
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

/**
 * Resolves to "the active cart": the cart matching `storage.cartId` if one is
 * present. With `create: true`, bootstraps a new cart via
 * `client.carts.getCurrent({siteCode, create: true})` when storage is empty —
 * useful on cart-page mounts where you want a cart unconditionally.
 *
 * Auto-detects auth (customer if a token is stored, else anonymous), same as
 * `useCart` and the other read hooks.
 *
 * Returns `UseQueryResult<Cart | null>`. `data: null` means "no cart yet and
 * create was not requested" — a deliberate signal so an empty-state can
 * render without confusing it with the loading state.
 */
export function useActiveCart(opts?: {
  create?: boolean;
  type?: string;
  legalEntityId?: string;
  auth?: AuthContext;
}): UseQueryResult<Cart | null> {
  const { client, storage } = useEmporix();
  const { ctx, kind } = useReadAuth(opts?.auth);

  const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());

  useEffect(() => {
    if (cartId !== null) return;
    if (!opts?.create) return;
    const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
    if (!siteCode) return;
    let cancelled = false;
    client.carts
      .getCurrent(ctx, {
        siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
        create: true,
      })
      .then((cart) => {
        if (cancelled) return;
        if (cart?.id) {
          storage.setCartId(cart.id);
          setCartId(cart.id);
        }
      })
      .catch(() => {
        // Best-effort bootstrap; downstream useQuery error surfaces real issues.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId, opts?.create, opts?.type, opts?.legalEntityId, kind]);

  return useQuery<Cart | null>({
    queryKey: [
      "emporix",
      "active-cart",
      cartId,
      { tenant: client.tenant, authKind: kind },
    ],
    enabled: cartId !== null,
    queryFn: async () => {
      if (cartId === null) return null;
      return client.carts.get(cartId, ctx);
    },
  });
}
