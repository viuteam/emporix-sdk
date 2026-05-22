import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type CheckoutInput,
  type QuoteCheckoutInput,
  type CheckoutResult,
  type PaymentMode,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";

const PAYMENT_MODES_STALE_TIME = 10 * 60_000; // 10 minutes — admin-configured.

// Lazy customer-only context resolver. Throws only when invoked — so the
// `enabled: token !== null` gate above the queryFn is the actual guard.
// Can't use the `useCustomerOnlyCtx` hook here because it would throw at
// hook-render time, before the enabled-gate kicks in.
function customerOnlyCtx(token: string | null): AuthContext {
  if (!token) throw new Error("usePaymentModes requires a logged-in customer token");
  return auth.customer(token);
}

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
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  const placeOrder = useMutation({
    mutationFn: (v: { input: CheckoutInput; saasToken?: string; siteCode?: string }) =>
      client.checkout.placeOrder(v.input, ctx, {
        ...(v.saasToken !== undefined ? { saasToken: v.saasToken } : {}),
        ...(v.siteCode !== undefined ? { siteCode: v.siteCode } : {}),
      }),
  });
  const placeOrderFromQuote = useMutation({
    mutationFn: (v: { input: QuoteCheckoutInput; saasToken?: string; siteCode?: string }) =>
      client.checkout.placeOrderFromQuote(v.input, ctx, {
        ...(v.saasToken !== undefined ? { saasToken: v.saasToken } : {}),
        ...(v.siteCode !== undefined ? { siteCode: v.siteCode } : {}),
      }),
  });
  return { placeOrder, placeOrderFromQuote };
}

/** Lists frontend payment modes for the logged-in customer. */
export function usePaymentModes(
  options: { enabled?: boolean } = {},
): UseQueryResult<PaymentMode[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: emporixKey("payment-modes", [], { tenant: client.tenant, authKind: "customer", siteCode }),
    enabled: (options.enabled ?? true) && token !== null,
    queryFn: () => client.payments.listPaymentModes(customerOnlyCtx(token)),
    staleTime: PAYMENT_MODES_STALE_TIME,
  });
}
