import { Component, computed, linkedSignal, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { pickFee, resolveZone, type CheckoutInput, type Zone } from "@viu/emporix-sdk";
import {
  injectCart,
  injectCheckout,
  injectCustomerSession,
  injectEmporixSite,
  injectPaymentModes,
  injectShippingZones,
} from "@viu/emporix-sdk-angular";
import { cartLines, cartTotal, money, pickText } from "@viu/emporix-examples-shared";

interface AddressDraft {
  contactName: string;
  street: string;
  streetNumber: string;
  zipCode: string;
  city: string;
  country: string;
}

interface ShippingChoice {
  methodId: string;
  zoneId: string;
  methodName: string;
  amount: number;
  shippingTaxCode?: string;
}

@Component({
  selector: "app-checkout",
  imports: [RouterLink],
  template: `
    <h1>Checkout</h1>

    @if (orderId(); as id) {
      <div class="notice stack" style="max-width:560px">
        <strong>Order placed.</strong>
        <div>Order id <code>{{ id }}</code></div>
        <p class="small">
          Emporix closes the cart on a successful order, so the local cart id was dropped — the
          next add-to-cart bootstraps a fresh one. Keeping it would 404 every later cart read.
        </p>
        <a routerLink="/account">See it in your orders →</a>
      </div>
    } @else if (cartId() === null || lines().length === 0) {
      <p class="muted">Nothing to check out. <a routerLink="/">Browse the catalog →</a></p>
    } @else {
      <div class="stack" style="max-width:560px">
        <div class="card row-between">
          <span>{{ lines().length }} line(s)</span>
          <strong>
            @if (total(); as t) {
              {{ money(t.amount, t.currency) }}
            } @else {
              —
            }
          </strong>
        </div>

        <h2>Contact</h2>
        @if (session.isAuthenticated()) {
          <p class="small muted">
            Signed in as <strong>{{ email() }}</strong>. A logged-in checkout identifies the
            customer by id — Emporix answers «Cannot found customer» without it, and rejects an
            id a guest is not allowed to claim.
          </p>
        } @else {
          <label>
            <span>Email</span>
            <input
              type="email"
              required
              [value]="guestEmail()"
              (input)="guestEmail.set($any($event.target).value)"
            />
          </label>
        }
        <div class="row-between" style="gap:0.75rem">
          <label style="margin:0; flex:1">
            <span>First name</span>
            <input [value]="firstName()" (input)="firstName.set($any($event.target).value)" />
          </label>
          <label style="margin:0; flex:1">
            <span>Last name</span>
            <input [value]="lastName()" (input)="lastName.set($any($event.target).value)" />
          </label>
        </div>

        <h2>Shipping address</h2>
        <label>
          <span>Contact name</span>
          <input [value]="ship().contactName" (input)="patch('contactName', $event)" />
        </label>
        <div class="row-between" style="gap:0.75rem">
          <label style="margin:0; flex:3">
            <span>Street</span>
            <input [value]="ship().street" (input)="patch('street', $event)" />
          </label>
          <label style="margin:0; flex:1">
            <span>No.</span>
            <input [value]="ship().streetNumber" (input)="patch('streetNumber', $event)" />
          </label>
        </div>
        <div class="row-between" style="gap:0.75rem">
          <label style="margin:0; flex:1">
            <span>Postcode</span>
            <input [value]="ship().zipCode" (input)="patch('zipCode', $event)" />
          </label>
          <label style="margin:0; flex:2">
            <span>City</span>
            <input [value]="ship().city" (input)="patch('city', $event)" />
          </label>
          <label style="margin:0; flex:1">
            <span>Country</span>
            <input maxlength="2" [value]="ship().country" (input)="patch('country', $event)" />
          </label>
        </div>
        <p class="small muted">
          Billing mirrors shipping here. Emporix requires at least one address of each type; a
          real storefront would offer a second form.
        </p>

        <h2>Delivery</h2>
        @if (zones.isPending()) {
          <p class="muted small">Loading shipping options…</p>
        } @else if (options().length === 0) {
          <p class="muted small">
            No configured method for <code>{{ ship().country }}</code>, so this falls back to
            free shipping keyed on the country — visible in the payload below.
          </p>
        } @else {
          <label>
            <span>Method</span>
            <select (change)="pickShipping($any($event.target).value)">
              @for (o of options(); track o.methodId) {
                <option [value]="o.methodId" [selected]="o.methodId === chosenShipping()?.methodId">
                  {{ o.methodName }} — {{ money(o.amount, currency()) }}
                </option>
              }
            </select>
          </label>
        }

        <h2>Payment</h2>
        @if (modes.isPending()) {
          <p class="muted small">Loading payment modes…</p>
        } @else {
          <label>
            <span>Mode</span>
            <select (change)="modeId.set($any($event.target).value || null)">
              <option value="">custom — no gateway, order stays IN_CHECKOUT</option>
              @for (m of paymentModes(); track m.id) {
                <option [value]="m.id" [selected]="m.id === modeId()">{{ m.name ?? m.id }}</option>
              }
            </select>
          </label>
          <p class="small muted">
            The <code>custom</code> provider is the default on purpose: it records the order
            without attempting a capture, which is why every existing order on this tenant reads
            <code>IN_CHECKOUT</code>. Picking a configured mode routes through the payment
            gateway for real.
          </p>
        }

        @if (error(); as e) {
          <div class="notice error"><strong>Order failed.</strong> {{ e }}</div>
        }
        @if (missing().length > 0) {
          <div class="notice">Still needed: <strong>{{ missing().join(", ") }}</strong></div>
        }

        <button
          class="primary"
          type="button"
          [disabled]="placing() || missing().length > 0"
          (click)="place()"
        >
          {{ placing() ? "Placing the order…" : "Place order" }}
        </button>

        <details>
          <summary class="small">Show the exact payload this sends</summary>
          <pre class="small card" style="overflow-x:auto">{{ preview() }}</pre>
        </details>
      </div>
    }
  `,
})
export class Checkout {
  protected readonly site = injectEmporixSite();
  protected readonly session = injectCustomerSession();

  protected readonly money = money;

  /**
   * No cart id, no storage subscription, no manual auth context.
   *
   * `injectCart` resolves the stored id itself; `injectCheckout` takes the auth
   * context and the `saas-token` header from the session, and drops the cart id
   * when Emporix closes the cart. This component used to carry all of it.
   */
  private readonly cart = injectCart();
  private readonly checkout = injectCheckout();
  protected readonly lines = computed(() => cartLines(this.cart.data()));
  protected readonly total = computed(() => cartTotal(this.cart.data()));
  protected readonly currency = computed(
    () => this.total()?.currency ?? this.site.currency() ?? "CHF",
  );
  protected readonly cartId = computed(() => this.cart.data()?.id ?? null);

  protected readonly modes = injectPaymentModes();
  protected readonly zones = injectShippingZones();

  protected readonly guestEmail = signal("");

  /**
   * Prefilled from the profile, still editable.
   *
   * `linkedSignal`, not `signal`: the profile arrives asynchronously, so a plain
   * signal initialised in the constructor would keep "Guest" forever for a
   * customer who is already signed in. This follows the source until the shopper
   * types, and re-derives if the source changes — which is exactly the case a
   * one-shot read gets wrong.
   */
  protected readonly firstName = linkedSignal(
    () => this.session.customer()?.firstName ?? "Guest",
  );
  protected readonly lastName = linkedSignal(() => this.session.customer()?.lastName ?? "Shopper");

  protected readonly ship = linkedSignal<AddressDraft>(() => ({
    contactName: this.contactNameFromProfile(),
    street: "Rennweg",
    streetNumber: "38",
    zipCode: "8001",
    city: "Zürich",
    country: "CH",
  }));
  protected readonly modeId = signal<string | null>(null);
  private readonly shippingOverride = signal<string | null>(null);

  protected readonly placing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly orderId = signal<string | null>(null);


  /** The profile's name, when it has one — otherwise a placeholder. */
  private contactNameFromProfile(): string {
    const c = this.session.customer();
    const parts = [c?.firstName, c?.lastName].filter((v): v is string => typeof v === "string");
    return parts.length > 0 ? parts.join(" ") : "Guest Shopper";
  }

  /** A logged-in customer checks out under their account email. */
  protected readonly email = computed(() =>
    this.session.isAuthenticated()
      ? (this.session.customer()?.contactEmail ?? this.guestEmail())
      : this.guestEmail(),
  );

  /**
   * Delivery options for the typed country, each with its applicable fee.
   *
   * `resolveZone` and `pickFee` come from the SDK rather than being re-derived
   * here: the fee rule is «highest `minOrderValue` at or below the cart total»,
   * and the `<=` matters — a total that exactly meets a free-shipping threshold
   * should get free shipping.
   */
  protected readonly options = computed<ShippingChoice[]>(() => {
    const zone = resolveZone(this.zones.data() as unknown as Zone[] | undefined, this.ship().country);
    if (zone === undefined) return [];
    const cartAmount = this.total()?.amount ?? 0;
    const out: ShippingChoice[] = [];
    // Skip inactive methods and ones with no fee table: neither is selectable,
    // and offering them means an order Emporix rejects.
    const selectable = (zone.methods ?? []).filter(
      (m) => m.active !== false && (m.fees?.length ?? 0) > 0,
    );
    for (const method of selectable) {
      const fee = pickFee(method.fees, cartAmount);
      if (fee === undefined || method.id === undefined || zone.id === undefined) continue;
      out.push({
        methodId: method.id,
        zoneId: zone.id,
        methodName: pickText(method.name, method.id),
        amount: fee.cost?.amount ?? 0,
        ...(method.shippingTaxCode !== undefined
          ? { shippingTaxCode: method.shippingTaxCode }
          : {}),
      });
    }
    return out;
  });

  protected readonly chosenShipping = computed<ShippingChoice | undefined>(() => {
    const all = this.options();
    const override = this.shippingOverride();
    return all.find((o) => o.methodId === override) ?? all[0];
  });

  protected readonly paymentModes = computed(
    () => (this.modes.data() as Array<{ id?: string; name?: string }> | undefined) ?? [],
  );

  /** What the form still lacks, so the disabled button says why. */
  protected readonly missing = computed(() => {
    const out: string[] = [];
    const a = this.ship();
    if (this.email().trim() === "") out.push("email");
    if (a.contactName.trim() === "") out.push("contact name");
    if (a.street.trim() === "") out.push("street");
    if (a.zipCode.trim() === "") out.push("postcode");
    if (a.city.trim() === "") out.push("city");
    if (a.country.trim().length !== 2) out.push("country (ISO-2)");
    return out;
  });

  protected patch(key: keyof AddressDraft, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.ship.update((a) => ({ ...a, [key]: key === "country" ? value.toUpperCase() : value }));
  }

  protected pickShipping(methodId: string): void {
    this.shippingOverride.set(methodId === "" ? null : methodId);
  }

  /** The payload, rendered so a reader can check it before pressing the button. */
  protected readonly preview = computed(() => JSON.stringify(this.buildInput(), null, 2));

  private buildInput(): CheckoutInput {
    const a = this.ship();
    const address = (type: "SHIPPING" | "BILLING") => ({
      contactName: a.contactName,
      street: a.street,
      ...(a.streetNumber !== "" ? { streetNumber: a.streetNumber } : {}),
      zipCode: a.zipCode,
      city: a.city,
      country: a.country,
      type,
    });
    const chosen = this.chosenShipping();
    const amount = this.total()?.amount ?? 0;
    const customerId = this.session.customer()?.id;
    const authenticated = this.session.isAuthenticated();

    return {
      cartId: this.cartId() ?? "",
      customer: {
        // Present iff logged in. Emporix answers "Cannot found customer" when a
        // customer checkout omits the id, and rejects an id a guest claims.
        ...(authenticated && customerId !== undefined ? { id: customerId } : {}),
        email: this.email(),
        firstName: this.firstName(),
        lastName: this.lastName(),
        guest: !authenticated,
      },
      // At least one SHIPPING and one BILLING are required by the API.
      addresses: [address("SHIPPING"), address("BILLING")],
      shipping:
        chosen !== undefined
          ? {
              methodId: chosen.methodId,
              zoneId: chosen.zoneId,
              methodName: chosen.methodName,
              amount: chosen.amount,
              ...(chosen.shippingTaxCode !== undefined
                ? { shippingTaxCode: chosen.shippingTaxCode }
                : {}),
            }
          : { methodId: "free", zoneId: a.country, methodName: "Free Shipping", amount: 0 },
      paymentMethods:
        this.modeId() !== null
          ? [
              {
                provider: "payment-gateway",
                customAttributes: { modeId: this.modeId() as string },
                amount,
              },
            ]
          : [{ provider: "custom", amount }],
      currency: this.currency(),
    };
  }

  /**
   * Place the order.
   *
   * Three things Emporix rejects otherwise: the customer id present exactly when
   * logged in, the `saas-token` header on a customer checkout, and dropping the
   * local cart id on success — the cart is closed server-side, so a kept id makes
   * every later cart read 404 with nothing to bootstrap over.
   */
  protected async place(): Promise<void> {
    if (this.missing().length > 0) return;
    // Everything this used to do by hand — resolving the auth context, attaching
    // the saas-token header, passing siteCode, dropping the closed cart — is the
    // binding's job now.
    await this.checkout.placeOrder(this.buildInput()).catch(() => {
      /* surfaced via checkout.error() */
    });
  }
}
