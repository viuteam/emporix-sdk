import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EmporixError, EmporixNotFoundError } from "@viu/emporix-sdk";
import type { PaymentMode } from "@viu/emporix-sdk";
import {
  useActiveCart,
  useActiveSite,
  useCheckout,
  useCustomerAddresses,
  useCustomerSession,
  useEmporix,
  usePaymentModes,
} from "@viu/emporix-sdk-react";
import { money } from "@viu/emporix-examples-shared";
import { cartLines } from "../lib/adapters";
import { useProductDetails } from "../lib/useProductNames";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { errorMessage } from "../app/Toasts";
import { CheckoutStep, type StepState } from "../checkout/CheckoutStep";
import { ContactStep, contactErrors, type ContactDraft } from "../checkout/ContactStep";
import { AddressStep } from "../checkout/AddressStep";
import { DeliveryStep, fallbackDelivery, useDeliveryOptions } from "../checkout/DeliveryStep";
import { PaymentStep, modeLabel, type PaymentDraft } from "../checkout/PaymentStep";
import { ReviewStep, type SubmitError } from "../checkout/ReviewStep";
import { OrderSummary } from "../checkout/OrderSummary";
import { Confirmation, type PlacedOrder } from "../checkout/Confirmation";
import { EMPTY_ADDRESS, addressErrors, addressToDraft, formatAddress, type AddressDraft } from "../checkout/AddressFields";
import { checkoutTotals } from "../checkout/totals";

type Step = 1 | 2 | 3 | 4 | 5;
type FormStep = Exclude<Step, 5>;
const TITLES: Record<Step, string> = {
  1: "Contact",
  2: "Shipping address",
  3: "Delivery",
  4: "Payment",
  5: "Review & place order",
};
type ReadCustomer = { id?: string; firstName?: string; lastName?: string; contactEmail?: string };

export function Checkout() {
  const { storage, client } = useEmporix();
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  // Once the order is placed the cart is closed — stop bootstrapping, otherwise
  // `getCurrent` re-adopts the just-closed cart id and every later fetch 404s.
  const { data: cart, isLoading } = useActiveCart({ create: placed === null });
  const { isAuthenticated, customer, saasToken } = useCustomerSession();
  const { placeOrder } = useCheckout();
  const site = useActiveSite();
  const countries = site?.shipToCountries ?? [];
  const firstCountry = countries[0];
  // Idle (data undefined) for guests: no saved addresses.
  const { data: savedData } = useCustomerAddresses();
  const saved = savedData ?? [];
  const { data: modesData, isLoading: modesLoading } = usePaymentModes();
  const modes: PaymentMode[] = modesData ?? [];

  const cartId = (cart as { id?: string } | null)?.id;
  const lines = cartLines(cart);
  const details = useProductDetails(lines.map((l) => l.productId));
  const cust = customer as ReadCustomer | null;

  const [step, setStep] = useState<Step>(1);
  const [reached, setReached] = useState<Step>(1);
  const [contact, setContact] = useState<ContactDraft>({ email: "", firstName: "", lastName: "" });
  const [shipping, setShipping] = useState<AddressDraft>({ ...EMPTY_ADDRESS });
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft>({ modeId: null, billingSame: true, billing: { ...EMPTY_ADDRESS } });
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  // Prefill from the profile once it loads; what the shopper typed wins.
  useEffect(() => {
    if (!cust) return;
    setContact((c) => ({
      email: c.email || cust.contactEmail || "",
      firstName: c.firstName || cust.firstName || "",
      lastName: c.lastName || cust.lastName || "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cust?.id]);

  // The default saved address, else the site's first country.
  const defaultSaved = saved.find((a) => a.isDefault) ?? saved[0];
  useEffect(() => {
    if (defaultSaved) setShipping((s) => (s.street ? s : addressToDraft(defaultSaved)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSaved?.id]);
  useEffect(() => {
    if (firstCountry) setShipping((s) => (s.country ? s : { ...s, country: firstCountry }));
  }, [firstCountry]);

  // A site that says nothing about tax is taken as tax-inclusive, the B2C default.
  const includesTax = site?.includesTax !== false;
  const orderValue = checkoutTotals(cart, null, includesTax)?.orderValue;
  const shipCountry = shipping.country || firstCountry || "";
  const { options, isLoading: optionsLoading } = useDeliveryOptions(shipCountry, orderValue);
  // The first method is preselected; the fallback only once nothing resolved.
  const delivery =
    options.find((o) => o.methodId === deliveryId) ?? options[0] ?? (optionsLoading ? null : fallbackDelivery(shipCountry));
  const totals = checkoutTotals(cart, delivery, includesTax);
  const modeId = payment.modeId ?? modes[0]?.id ?? null;
  const mode = modes.find((m) => m.id === modeId);
  const paymentLabel = mode ? modeLabel(mode) : "Custom (demo)";
  const billingLabel = payment.billingSame ? "billing same as shipping" : `billing ${formatAddress(payment.billing)}`;

  const valid: Record<FormStep, boolean> = {
    1: Object.keys(contactErrors(contact)).length === 0 && (!isAuthenticated || Boolean(saasToken)),
    2: Object.keys(addressErrors(shipping, countries)).length === 0,
    3: delivery !== null,
    4: !modesLoading && (payment.billingSame || Object.keys(addressErrors(payment.billing, countries)).length === 0),
  };

  // A returning customer with everything on file starts at the review — once,
  // after the prefill effects above have applied.
  const jumped = useRef(false);
  const prefilled = (!cust || Boolean(contact.email)) && (!defaultSaved || Boolean(shipping.street));
  const ready = !isLoading && !optionsLoading && !modesLoading && savedData !== undefined && prefilled;
  useEffect(() => {
    if (jumped.current || !isAuthenticated || !ready) return;
    jumped.current = true;
    if (valid[1] && valid[2] && valid[3] && valid[4]) {
      setStep(5);
      setReached(5);
    }
  });

  function go(s: Step) {
    setStep(s);
    setReached((r) => (s > r ? s : r));
    setSubmitError(null);
  }
  function continueFrom(s: FormStep) {
    if (s === 1 && !shipping.contactName) {
      setShipping((a) => ({ ...a, contactName: `${contact.firstName} ${contact.lastName}`.trim() }));
    }
    const later: Step[] = [2, 3, 4, 5];
    go(later.find((n) => n > s && (n === 5 || n > reached || !valid[n as FormStep])) ?? 5);
  }
  const stateOf = (s: Step): StepState => (s === step ? "open" : s !== 5 && s <= reached && valid[s] ? "done" : "todo");

  async function place() {
    if (!cartId || !totals || !delivery) return;
    setSubmitError(null);
    const billing = payment.billingSame ? shipping : payment.billing;
    const toAddress = (a: AddressDraft, type: "SHIPPING" | "BILLING") => ({
      contactName: a.contactName,
      ...(a.companyName ? { companyName: a.companyName } : {}),
      street: a.street,
      ...(a.streetNumber ? { streetNumber: a.streetNumber } : {}),
      zipCode: a.zipCode,
      city: a.city,
      country: a.country,
      ...(a.contactPhone ? { contactPhone: a.contactPhone } : {}),
      type,
    });
    const input = {
      cartId,
      customer: {
        // A signed-in customer must be identified by id; a guest must not.
        ...(isAuthenticated && cust?.id ? { id: cust.id } : {}),
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        guest: !isAuthenticated,
      },
      shipping: {
        methodId: delivery.methodId,
        zoneId: delivery.zoneId,
        methodName: delivery.methodName,
        amount: delivery.amount,
        ...(delivery.shippingTaxCode ? { shippingTaxCode: delivery.shippingTaxCode } : {}),
      },
      addresses: [toAddress(shipping, "SHIPPING"), toAddress(billing, "BILLING")],
      // The payment amount is the total the shopper saw: items plus delivery, gross.
      paymentMethods: modeId
        ? [{ provider: "payment-gateway", customAttributes: { modeId }, amount: totals.total }]
        : [{ provider: "custom", amount: totals.total }],
    };
    try {
      const r = await placeOrder.mutateAsync({
        input,
        // A customer checkout must carry the saasToken; a guest's does not.
        ...(isAuthenticated && saasToken ? { saasToken } : {}),
      });
      setPlaced({
        orderId: (r as { orderId?: string }).orderId ?? "",
        email: contact.email,
        lines,
        details,
        totals,
        shipping,
        deliveryName: delivery.methodName,
        paymentLabel,
        signedIn: isAuthenticated,
      });
      // The cart is CLOSED on Emporix after a successful order — drop it locally
      // so `useActiveCart` stops querying the closed cart.
      storage.setCartId(null);
    } catch (err) {
      if (err instanceof EmporixNotFoundError) {
        setSubmitError({ message: "This cart no longer exists. It may have been checked out in another tab.", toCart: true });
      } else if (err instanceof EmporixError && err.status === 409) {
        setSubmitError({ message: "An order already exists for this cart.", toCart: true });
      } else {
        setSubmitError({ message: errorMessage(err), toCart: false });
      }
    }
  }

  if (placed) return <Confirmation order={placed} />;
  if (isLoading) {
    return (
      <div className="container">
        <Loading label="Loading checkout" />
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div className="container">
        <EmptyState title="Your cart is empty">
          Add something before checking out — <Link to="/" className="u-underline">browse</Link>.
        </EmptyState>
      </div>
    );
  }

  const currency = totals?.currency ?? "";
  return (
    <div className="container checkout">
      <div className="checkout__head">
        <h1 className="page-title">Checkout</h1>
        <Link to="/cart" className="u-underline">
          ← Back to cart
        </Link>
      </div>
      <div className="co-layout">
        <div className="co-steps">
          <CheckoutStep
            index={1}
            title={TITLES[1]}
            state={stateOf(1)}
            summary={`${contact.email} · ${isAuthenticated ? "signed in" : "guest"}`}
            onEdit={() => go(1)}
          >
            <ContactStep value={contact} onChange={(p) => setContact((c) => ({ ...c, ...p }))} onContinue={() => continueFrom(1)} />
          </CheckoutStep>
          <CheckoutStep index={2} title={TITLES[2]} state={stateOf(2)} summary={formatAddress(shipping)} onEdit={() => go(2)}>
            <AddressStep
              value={shipping}
              onChange={(p) => setShipping((s) => ({ ...s, ...p }))}
              saved={saved}
              countries={countries}
              onContinue={() => continueFrom(2)}
            />
          </CheckoutStep>
          <CheckoutStep
            index={3}
            title={TITLES[3]}
            state={stateOf(3)}
            summary={delivery ? `${delivery.methodName} · ${delivery.amount === 0 ? "Free" : money(delivery.amount, currency)}` : undefined}
            onEdit={() => go(3)}
          >
            <DeliveryStep
              options={options}
              isLoading={optionsLoading}
              country={shipCountry}
              currency={currency}
              includesTax={includesTax}
              value={delivery?.methodId ?? null}
              onChange={setDeliveryId}
              onContinue={() => continueFrom(3)}
            />
          </CheckoutStep>
          <CheckoutStep index={4} title={TITLES[4]} state={stateOf(4)} summary={`${paymentLabel} · ${billingLabel}`} onEdit={() => go(4)}>
            <PaymentStep
              modes={modes}
              isLoading={modesLoading}
              value={{ ...payment, modeId }}
              onChange={(p) => setPayment((x) => ({ ...x, ...p }))}
              saved={saved}
              countries={countries}
              onContinue={() => continueFrom(4)}
            />
          </CheckoutStep>
          <CheckoutStep index={5} title={TITLES[5]} state={stateOf(5)}>
            <ReviewStep
              rows={[
                { step: 1, label: "Contact", value: `${contact.firstName} ${contact.lastName} · ${contact.email}`, onEdit: () => go(1) },
                { step: 2, label: "Ship to", value: formatAddress(shipping), onEdit: () => go(2) },
                { step: 3, label: "Delivery", value: delivery?.methodName ?? "—", onEdit: () => go(3) },
                { step: 4, label: "Payment", value: `${paymentLabel} · ${billingLabel}`, onEdit: () => go(4) },
              ]}
              total={totals ? money(totals.total, totals.currency) : "—"}
              tenant={client.tenant}
              busy={placeOrder.isPending}
              error={submitError}
              onPlace={() => void place()}
            />
          </CheckoutStep>
        </div>
        <OrderSummary lines={lines} details={details} totals={totals} deliveryName={delivery?.methodName} />
      </div>
    </div>
  );
}
