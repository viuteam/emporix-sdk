import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  type CheckoutInput,
  type QuoteCheckoutInput,
  type CheckoutResult,
  type PaymentMode,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";
import { useActiveCompany } from "../company-context";

const PAYMENT_MODES_STALE_TIME = 10 * 60_000; // 10 minutes — admin-configured.

/** Checkout actions bound to the stored customer session. */
export interface CheckoutApi {
  placeOrder: UseMutationResult<
    CheckoutResult,
    unknown,
    { input: CheckoutInput; saasToken?: string; siteCode?: string }
  >;
  placeOrderFromQuote: UseMutationResult<
    CheckoutResult,
    unknown,
    { input: QuoteCheckoutInput; saasToken?: string; siteCode?: string }
  >;
}

/** React bindings for the checkout flow. */
export function useCheckout(): CheckoutApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const { ctx } = useReadAuth();
  const { activeCompany } = useActiveCompany();
  // Merge the active legal-entity id into the order payload when set; caller's
  // explicit value wins. Cast-through to keep CheckoutInput's typed-ness while
  // permitting a passthrough field the wire schema accepts but the generated
  // type may not yet name.
  const withLE = <T extends object>(input: T): T => {
    if (!activeCompany?.id) return input;
    if ("legalEntityId" in input) return input;
    return { ...input, legalEntityId: activeCompany.id } as T;
  };
  // A placed order CLOSES its cart server-side. Drop the local cart id AND the
  // `cart-bootstrap` cache (which is held with `staleTime: Infinity`) so the
  // next `useActiveCart({ create: true })` bootstraps a FRESH cart instead of
  // re-adopting the now-closed one — otherwise the next checkout's cart reads
  // 404 and its placeOrder 401s. Not a per-cart-query invalidate: that would
  // refetch the just-closed id (404). `setCartId(null)` disables that query.
  const onOrderPlaced = (): void => {
    storage.setCartId(null);
    qc.removeQueries({ queryKey: ["emporix", "cart-bootstrap"] });
  };
  const placeOrder = useMutation({
    mutationFn: (v: { input: CheckoutInput; saasToken?: string; siteCode?: string }) =>
      client.checkout.placeOrder(withLE(v.input), ctx, {
        ...(v.saasToken !== undefined ? { saasToken: v.saasToken } : {}),
        ...(v.siteCode !== undefined ? { siteCode: v.siteCode } : {}),
      }),
    onSuccess: onOrderPlaced,
  });
  const placeOrderFromQuote = useMutation({
    mutationFn: (v: { input: QuoteCheckoutInput; saasToken?: string; siteCode?: string }) =>
      client.checkout.placeOrderFromQuote(withLE(v.input), ctx, {
        ...(v.saasToken !== undefined ? { saasToken: v.saasToken } : {}),
        ...(v.siteCode !== undefined ? { siteCode: v.siteCode } : {}),
      }),
    onSuccess: onOrderPlaced,
  });
  return { placeOrder, placeOrderFromQuote };
}

/** Lists frontend payment modes for the current session (customer or guest). */
export function usePaymentModes(
  options: { enabled?: boolean } = {},
): UseQueryResult<PaymentMode[]> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  const { siteCode } = useReadSite();
  const { activeCompany } = useActiveCompany();
  return useQuery({
    queryKey: emporixKey(
      "payment-modes",
      [activeCompany?.id ?? null],
      { tenant: client.tenant, authKind: ctx.kind, siteCode },
    ),
    enabled: options.enabled ?? true,
    queryFn: () => client.payments.listPaymentModes(ctx),
    staleTime: PAYMENT_MODES_STALE_TIME,
  });
}
