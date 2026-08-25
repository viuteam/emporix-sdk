import { Component, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { auth } from "@viu/emporix-sdk";
import { injectEmporix } from "@viu/emporix-sdk-angular";
import { cartLines, cartTotal, money } from "@viu/emporix-examples-shared";
import { cartQuery, productNamesQuery } from "../lib/queries";

@Component({
  selector: "app-cart",
  imports: [RouterLink],
  template: `
    <h1>Cart</h1>

    @if (cartId() === null) {
      <p class="muted">Your cart is empty. <a routerLink="/">Browse the catalog →</a></p>
    } @else if (cart.isPending()) {
      <p class="muted">Loading cart…</p>
    } @else if (cart.isError()) {
      <div class="notice error">
        <strong>Could not load the cart.</strong> {{ cart.error()?.message }}
        <p class="small">
          A 404 here usually means the cart was closed by an order on another device. Emporix
          allows one open cart per site, and a stale id is not <code>null</code>, so nothing
          bootstraps over it — clearing it locally lets a fresh one be created.
        </p>
        <button type="button" (click)="forget()">Forget this cart</button>
      </div>
    } @else if (lines().length === 0) {
      <p class="muted">Your cart is empty. <a routerLink="/">Browse the catalog →</a></p>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Line total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (l of lines(); track l.id) {
            <tr>
              <td>{{ lineName(l) }}</td>
              <td>{{ l.quantity }}</td>
              <td>
                @if (l.lineTotal; as t) {
                  {{ money(t.amount, t.currency) }}
                } @else {
                  —
                }
              </td>
              <td>
                <button
                  class="link"
                  type="button"
                  [disabled]="busy() === l.id"
                  (click)="remove(l.id)"
                >
                  {{ busy() === l.id ? "removing…" : "remove" }}
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>

      <div class="row-between" style="margin-top:1rem">
        <strong>
          @if (total(); as t) {
            Total {{ money(t.amount, t.currency) }}
          } @else {
            Total —
          }
        </strong>
        <a class="card" routerLink="/checkout"><strong>Checkout →</strong></a>
      </div>

      @if (error(); as e) {
        <div class="notice error" style="margin-top:1rem"><strong>Failed.</strong> {{ e }}</div>
      }
    }
  `,
})
export class CartPage {
  private readonly emporix = injectEmporix();

  protected readonly money = money;
  protected readonly cartId = signal(this.emporix.storage.getCartId());
  protected readonly cart = cartQuery(this.cartId.asReadonly());

  protected readonly lines = computed(() => cartLines(this.cart.data()));
  protected readonly total = computed(() => cartTotal(this.cart.data()));

  /**
   * Names for lines whose stored snapshot has none.
   *
   * A cart item carries only an `itemYrn`, so `toCartLine` can end up with an
   * empty name — which rendered as a blank cell against the live tenant until
   * this was added. One bulk read for every id on the page.
   */
  private readonly lineProductIds = computed(() =>
    this.lines()
      .map((l) => l.productId)
      .filter((id): id is string => id !== undefined && id !== ""),
  );
  private readonly names = productNamesQuery(this.lineProductIds);

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Storage writes come from anywhere — an add-to-cart on the product page, a
    // login merging a guest cart, a site switch dropping the id.
    this.emporix.storage.subscribeAll?.((key) => {
      if (key === "cartId") this.cartId.set(this.emporix.storage.getCartId());
    });
  }

  protected lineName(l: { name: string; productId: string }): string {
    // The snapshot wins when it has one — it is what the shopper saw when they
    // added the item, even if the product has been renamed since.
    return l.name !== "" ? l.name : (this.names.data()?.[l.productId] ?? l.productId);
  }

  protected async remove(itemId: string): Promise<void> {
    const id = this.cartId();
    if (id === null) return;
    this.error.set(null);
    this.busy.set(itemId);
    try {
      const token = this.emporix.storage.getCustomerToken();
      await this.emporix.client.carts.removeItem(
        id,
        itemId,
        token !== null ? auth.customer(token) : auth.anonymous(),
      );
      await this.cart.refetch();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(null);
    }
  }

  /**
   * Drop a cart id the server no longer has.
   *
   * The manual version of what React's `forgetGoneCart` does automatically. A
   * package-level `injectCart` should absorb it, because a shopper cannot be
   * expected to press a button to escape a dead cart.
   */
  protected forget(): void {
    this.emporix.storage.setCartId(null);
    this.error.set(null);
  }
}
