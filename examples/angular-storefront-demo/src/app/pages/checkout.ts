import { Component, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { auth } from "@viu/emporix-sdk";
import {
  injectCustomerSession,
  injectEmporix,
  injectEmporixSite,
} from "@viu/emporix-sdk-angular";
import { cartLines } from "@viu/emporix-examples-shared";
import { cartQuery, paymentModesQuery, shippingZonesQuery } from "../lib/queries";

@Component({
  selector: "app-checkout",
  imports: [RouterLink],
  template: `
    <h1>Checkout</h1>

    @if (cartId() === null) {
      <p class="muted">Nothing to check out. <a routerLink="/">Browse the catalog →</a></p>
    } @else {
      <div class="stack" style="max-width:560px">
        <div class="card">
          <div class="row-between">
            <span>Cart</span>
            <strong>{{ itemCount() }} item(s)</strong>
          </div>
        </div>

        <h2>Contact</h2>
        <label>
          <span>Email</span>
          <input
            type="email"
            required
            [value]="email()"
            (input)="email.set($any($event.target).value)"
          />
        </label>

        <h2>Shipping address</h2>
        <label>
          <span>Street and number</span>
          <input [value]="street()" (input)="street.set($any($event.target).value)" />
        </label>
        <label>
          <span>Postcode and city</span>
          <input [value]="city()" (input)="city.set($any($event.target).value)" />
        </label>
        <label>
          <span>Country (ISO-2)</span>
          <input
            maxlength="2"
            [value]="country()"
            (input)="country.set($any($event.target).value.toUpperCase())"
          />
        </label>

        <h2>Shipping</h2>
        @if (zones.isPending()) {
          <p class="muted small">Loading shipping options…</p>
        } @else if (zones.isError()) {
          <p class="muted small">No shipping options could be loaded.</p>
        } @else {
          <p class="muted small">
            Shipping zones resolved for site <code>{{ site.siteCode() ?? "—" }}</code>.
          </p>
        }

        <h2>Payment</h2>
        @if (modes.isPending()) {
          <p class="muted small">Loading payment modes…</p>
        } @else if (modes.isError()) {
          <p class="muted small">No payment modes could be loaded.</p>
        } @else {
          <p class="muted small">
            Payment modes load for guests too — the endpoint needs a bearer token but no
            customer scope, so gating them on a login would hide them from every guest.
          </p>
        }

        <div class="notice">
          <strong>This example stops here.</strong>
          It gathers what <code>client.checkout.placeOrder</code> needs and shows the payload,
          but does not submit it — placing a real order on a tenant is a side effect an example
          should not have. Wire the button to <code>placeOrder</code> in your own storefront.
        </div>

        <details>
          <summary class="small">Show the payload this page would send</summary>
          <pre class="small card" style="overflow-x:auto">{{ payload() }}</pre>
        </details>
      </div>
    }
  `,
})
export class Checkout {
  private readonly emporix = injectEmporix();
  protected readonly site = injectEmporixSite();
  private readonly session = injectCustomerSession();

  protected readonly cartId = signal(this.emporix.storage.getCartId());
  private readonly cart = cartQuery(this.cartId.asReadonly());
  protected readonly itemCount = computed(() => cartLines(this.cart.data()).length);

  protected readonly modes = paymentModesQuery();
  protected readonly zones = shippingZonesQuery(this.site.siteCode);

  protected readonly email = signal("");
  protected readonly street = signal("");
  protected readonly city = signal("");
  protected readonly country = signal("CH");

  constructor() {
    this.emporix.storage.subscribeAll?.((key) => {
      if (key === "cartId") this.cartId.set(this.emporix.storage.getCartId());
    });
  }

  /**
   * The checkout payload, rendered instead of sent.
   *
   * Shown rather than submitted on purpose: an example that places orders leaves
   * real rows on whatever tenant someone points it at.
   */
  protected readonly payload = computed(() =>
    JSON.stringify(
      {
        cartId: this.cartId(),
        customer: this.session.isAuthenticated()
          ? {
              id: this.session.customer()?.id,
              // `contactEmail`, not `email` — the generated Customer has no `email`.
              email: this.session.customer()?.contactEmail,
            }
          : { email: this.email() },
        addresses: [
          {
            type: "SHIPPING",
            street: this.street(),
            city: this.city(),
            country: this.country(),
          },
        ],
        // The auth context the call would carry, by kind only — never the token.
        authKind: this.emporix.storage.getCustomerToken() !== null ? "customer" : "anonymous",
        siteCode: this.site.siteCode(),
        currency: this.site.currency(),
      },
      null,
      2,
    ),
  );

  /** Kept so the import is exercised and the shape is visible to a reader. */
  protected authContext(): ReturnType<typeof auth.anonymous> {
    const token = this.emporix.storage.getCustomerToken();
    return token !== null ? auth.customer(token) : auth.anonymous();
  }
}
