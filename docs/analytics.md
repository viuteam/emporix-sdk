# Analytics & Tracking (Google Tag Manager / GA4)

The SDK is **analytics-vendor-agnostic**. It ships no GTM, GA4, Segment, or
Datadog code — instead it exposes one typed **telemetry channel**, and you wire
whatever sink you like to it. This guide uses **Google Tag Manager (GTM)** with
**GA4 ecommerce** events as the worked example; the same pattern drives any
provider (GA4 direct via `gtag`, Segment, Rudderstack, a server endpoint, …).

> Telemetry lives in `@viu/emporix-sdk-react`. See [`./react.md`](./react.md)
> for the provider basics.

## The telemetry channel

Two entry points, one stream:

- **`onTelemetry` prop** on `EmporixProvider` — receives every event the SDK
  emits automatically (technical lifecycle) **and** every event you emit.
- **`useEmporixTelemetry().emit(event)`** — emit your own semantic events on the
  same channel from anywhere under the provider.

Without an `onTelemetry` callback the whole layer is a **no-op** — `emit()` is
safe and free to call. The event is a typed discriminated union
(`EmporixTelemetryEvent`), so an exhaustive `switch` on `event.type` is
type-checked.

| `type` | Source | Carries |
| --- | --- | --- |
| `cache.hit` / `cache.miss` | React-Query query cache | `queryKey`, `tenant`, (`durationMs`) |
| `query.refetch` / `query.error` | React-Query query cache | `queryKey`, `tenant`, `reason` / `error` |
| `mutation.success` / `mutation.error` | React-Query mutation cache | `mutationKey?`, `tenant`, `durationMs`, (`error`) |
| `auth.refresh` | SDK token provider | `kind`, `tenant`, `success` |
| `storage.write` | Storage adapter | `key` |
| `company:switched` | B2B active-company switch | `from`, `to`, `durationMs` |
| `custom` | **You** (`emit`) | `name`, `props?` |

## Two layers, one channel

There are two kinds of event, and the distinction is the whole reason this guide
exists:

**Technical events** (`cache.*`, `query.*`, `mutation.*`, `auth.refresh`,
`storage.write`) are emitted automatically. They're great for **operations** —
cache effectiveness, API error rates, funnel timing, auth-refresh frequency.

**Semantic events** (`{ type: "custom", name, props }`) are emitted by **you**.
They're what GA4 ecommerce needs.

> ⚠️ **Don't try to build GA4 ecommerce from technical events.** The cart and
> checkout mutations do **not** set a `mutationKey`, and `mutation.success`
> carries only `{ durationMs, tenant }` — no product, price, quantity, or
> currency. You cannot reconstruct an `add_to_cart` payload from it. Always emit
> a **semantic** event at the call site, where the item/cart/order data is in
> scope.

## The GTM dataLayer bridge

GTM consumes `window.dataLayer.push(...)`. Wire it once, in the provider's
`onTelemetry` handler — this is the single boundary between the SDK and your
analytics stack:

```tsx
import { EmporixProvider } from "@viu/emporix-sdk-react";

<EmporixProvider
  client={client}
  storage={storage}
  onTelemetry={(event) => {
    if (typeof window === "undefined") return; // browser-only (see SSR below)
    const dl = (window.dataLayer ??= []);

    switch (event.type) {
      // Semantic ecommerce events → GA4
      case "custom":
        dl.push({ event: event.name, ...event.props });
        break;

      // Technical events → ops (optional)
      case "query.error":
      case "mutation.error":
        dl.push({ event: "app.api_error", api_event: event.type });
        break;
    }
  }}
>
  <App />
</EmporixProvider>;
```

GA4 ecommerce expects `ecommerce.items` and a preceding `ecommerce: null` reset.
Fold that into the bridge so your call sites stay simple:

```tsx
case "custom":
  dl.push({ ecommerce: null }); // clear the previous ecommerce object
  dl.push({ event: event.name, ecommerce: event.props });
  break;
```

## GA4 ecommerce event mapping

Emit these from the hook interactions. `props` is the GA4 `ecommerce` object
(`{ currency, value, items: [...] }`).

| GA4 event | Emit when | Driven by |
| --- | --- | --- |
| `view_item_list` | a product grid renders | `useProducts` / `useProductsInCategory` |
| `view_item` | a product detail page mounts | `useProduct` / `useProductByCode` |
| `add_to_cart` | `addItem` succeeds | `useCartMutations().addItem` |
| `remove_from_cart` | `removeItem` succeeds | `useCartMutations().removeItem` |
| `begin_checkout` | the checkout view mounts | `useActiveCart` (read the cart) |
| `add_shipping_info` | shipping step completed | `useCartMutations` (address set) |
| `add_payment_info` | payment mode chosen | `usePaymentModes` selection |
| `purchase` | `placeOrder` succeeds | `useCheckout().placeOrder` |

A single item maps like this (reuse a helper to build it from a product or cart
line):

```ts
function toGa4Item(p: { id: string; sku?: string; name?: string; price?: number }, quantity = 1) {
  return { item_id: p.sku ?? p.id, item_name: p.name, price: p.price, quantity };
}
```

## A reusable cart wrapper

Wrap `useCartMutations` once so every add/remove emits automatically — call
sites then use it like the normal hook and get tracking for free:

```tsx
import { useCartMutations, useEmporixTelemetry } from "@viu/emporix-sdk-react";

export function useTrackedCart(cartId?: string) {
  const cart = useCartMutations(cartId);
  const { emit } = useEmporixTelemetry();

  return {
    ...cart,
    addItem: async (input: Parameters<typeof cart.addItem.mutateAsync>[0], item: ReturnType<typeof toGa4Item>) => {
      const res = await cart.addItem.mutateAsync(input);
      emit({ type: "custom", name: "add_to_cart", props: { currency: "CHF", value: item.price! * item.quantity, items: [item] } });
      return res;
    },
    removeItem: async (vars: Parameters<typeof cart.removeItem.mutateAsync>[0], item: ReturnType<typeof toGa4Item>) => {
      const res = await cart.removeItem.mutateAsync(vars);
      emit({ type: "custom", name: "remove_from_cart", props: { currency: "CHF", items: [item] } });
      return res;
    },
  };
}
```

`view_item` on a product page — emit on mount once the product resolves:

```tsx
function ProductPage({ id }: { id: string }) {
  const { data: product } = useProduct(id);
  const { emit } = useEmporixTelemetry();
  useEffect(() => {
    if (!product) return;
    emit({ type: "custom", name: "view_item", props: { currency: "CHF", items: [toGa4Item(product)] } });
  }, [product, emit]);
  // …
}
```

`purchase` — emit from the `placeOrder` mutation's success:

```tsx
const { placeOrder } = useCheckout();
const { emit } = useEmporixTelemetry();

await placeOrder.mutateAsync({ input }, {
  onSuccess: (order) => {
    emit({ type: "custom", name: "purchase", props: {
      transaction_id: order.id,
      currency: order.totalPrice?.currency,
      value: order.totalPrice?.amount,
      items: order.entries?.map((e) => toGa4Item({ id: e.product?.id ?? "", name: e.product?.name, price: e.unitPrice?.amount }, e.quantity)),
    }});
  },
});
```

> Field names on `order` follow the SDK's order type — check
> [`./checkout.md`](./checkout.md) for the exact shape and adjust the mapping.

## SSR / RSC

`window.dataLayer` is **browser-only**. The `EmporixProvider` (and therefore
`onTelemetry`) runs **client-side**, so the bridge above is safe — but two
things follow:

- The `if (typeof window === "undefined") return;` guard in the handler is
  belt-and-braces for non-browser renders.
- Catalog data fetched in **React Server Components** (e.g. an RSC product list)
  produces no client telemetry. To fire `view_item_list` for server-rendered
  grids, emit from a small Client Component that mounts in the page (e.g. a
  `<ViewItemList items={…} />` that calls `emit` in an effect).

## Consent (FADP / GDPR)

Tracking is consent-gated in CH/EU. Don't push to `dataLayer` before the user
has consented. Either gate inside the bridge:

```tsx
onTelemetry={(event) => {
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return;
  // … dataLayer.push …
}}
```

…or use [Google Consent Mode](https://developers.google.com/tag-platform/security/guides/consent)
so tags buffer until consent is granted. Either way, the SDK emits regardless —
**the consent decision lives in your bridge**, the one place all events pass
through.

## Why this design

Keeping GTM/GA4 out of the SDK means the same `emit` calls feed any analytics
backend, the bridge is the only thing you swap, and there's a single audited
boundary for consent and PII. The SDK's job is to give you a typed, no-op-by-default
event stream; the mapping to a vendor is yours.
