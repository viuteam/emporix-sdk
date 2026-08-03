"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EmporixError, pickFee, resolveZone, type CheckoutInput } from "@viu/emporix-sdk";
import {
  STORAGE_KEYS,
  sessionCookieJar,
  withEmporixSessionMutable,
} from "@viu/emporix-sdk-next/session";
import { CONTEXT, EMPORIX, SITE } from "../emporix";

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

/** `LocalizedValue` is `string | Record<string, string>`. Pick something showable. */
function label(name: string | Record<string, string> | undefined, fallback: string): string {
  if (typeof name === "string") return name;
  if (name) return Object.values(name)[0] ?? fallback;
  return fallback;
}

/**
 * An error message worth reading.
 *
 * `EmporixError.message` is only the status line; the reason lives in `.body`.
 * Dropping it turns «400» into a guessing game — which is exactly what happened
 * while building this page.
 */
function describe(e: unknown): string {
  if (e instanceof EmporixError) {
    const detail = typeof e.body === "string" ? e.body : JSON.stringify(e.body);
    return `${e.message} — ${detail}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Places the order from the checkout form.
 *
 * The `saasToken` never leaves the server: it is read from an httpOnly cookie
 * here and handed to Emporix as a header. In the SPA mode the same token has to
 * be readable by JavaScript, because the checkout runs in the browser.
 */
export async function submitCheckout(formData: FormData): Promise<void> {
  const jar = await sessionCookieJar();
  const cartId = jar.get(STORAGE_KEYS.cartId);
  if (cartId === null) redirect("/checkout?error=No+cart");
  const saasToken = jar.get(STORAGE_KEYS.saasToken);
  const loggedIn = jar.get(STORAGE_KEYS.customerToken) !== null;

  const country = field(formData, "country") || CONTEXT.targetLocation;
  const firstName = field(formData, "firstName");
  const lastName = field(formData, "lastName");
  const modeId = field(formData, "modeId");

  let orderId: string | undefined;
  try {
    const result = await withEmporixSessionMutable(async (client, ctx) => {
      const [cart, zones, customerId] = await Promise.all([
        client.carts.get(cartId, ctx),
        client.shipping.listZones(
          SITE.siteCode,
          { expand: "methods,fees", activeMethods: "true" },
          ctx,
        ),
        // Emporix REQUIRES `customer.id` for a logged-in checkout and REJECTS it
        // for a guest — 400 either way if you get it backwards.
        loggedIn ? client.customers.me(ctx).then((c) => c.id) : Promise.resolve(undefined),
      ]);
      const total = cart.totalPrice?.amount ?? 0;

      // The form's radio is a hint, not the authority: the customer may have
      // typed a country that belongs to a different zone than the one the page
      // rendered. Re-resolve against what was actually submitted.
      const zone = resolveZone(zones, country);
      const methods = zone?.methods ?? [];
      const method = methods.find((m) => m.id === field(formData, "methodId")) ?? methods[0];
      const fee = pickFee(method?.fees, total);
      const shipping =
        zone && method && fee
          ? {
              methodId: method.id,
              zoneId: zone.id,
              methodName: label(method.name, method.id),
              amount: fee.cost.amount,
              ...(method.shippingTaxCode ? { shippingTaxCode: method.shippingTaxCode } : {}),
            }
          : { methodId: "free", zoneId: country, methodName: "Free Shipping", amount: 0 };

      const streetNumber = field(formData, "streetNumber");
      const address = {
        contactName: `${firstName} ${lastName}`.trim(),
        street: field(formData, "street"),
        ...(streetNumber ? { streetNumber } : {}),
        zipCode: field(formData, "zipCode"),
        city: field(formData, "city"),
        country,
      };

      const input: CheckoutInput = {
        cartId,
        customer: {
          ...(customerId !== undefined ? { id: customerId } : {}),
          email: field(formData, "email"),
          firstName,
          lastName,
          // A logged-in customer must NOT be flagged as a guest — Emporix takes
          // the identity off the token in that case.
          guest: !loggedIn,
        },
        shipping,
        addresses: [
          { ...address, type: "SHIPPING" },
          { ...address, type: "BILLING" },
        ],
        // `custom` is a documented Emporix provider, not a demo stand-in: the
        // order it creates carries the IN_CHECKOUT status and waits for payment.
        paymentMethods: modeId
          ? [{ provider: "payment-gateway", customAttributes: { modeId }, amount: total }]
          : [{ provider: "custom", amount: total }],
      };

      return client.checkout.placeOrder(input, ctx, {
        ...(loggedIn && saasToken !== null ? { saasToken } : {}),
        siteCode: SITE.siteCode,
      });
    }, EMPORIX);
    orderId = result.orderId;
  } catch (e) {
    // `redirect()` works by throwing. Every success redirect therefore lives
    // OUTSIDE this try — catching one's own redirect would swallow it.
    redirect(`/checkout?error=${encodeURIComponent(describe(e))}`);
  }

  // Emporix CLOSES the cart on a successful checkout. Keeping the id would
  // point the cart page at a dead resource.
  jar.delete(STORAGE_KEYS.cartId);
  revalidatePath("/cart");
  redirect(`/checkout/done?orderId=${encodeURIComponent(orderId ?? "")}`);
}
