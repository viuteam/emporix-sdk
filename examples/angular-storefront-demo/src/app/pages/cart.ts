import { Component, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import { injectCart, injectCartMutations, injectEmporix } from "@viu/emporix-sdk-angular";
import { cartLines, cartTotal, money } from "@viu/emporix-examples-shared";
import { productNamesQuery } from "../lib/queries";

@Component({
  selector: "app-cart",
  imports: [RouterLink],
  template: `
    <h1>Cart</h1>

    @if (cart.isPending()) {
      <p class="muted">Loading cart…</p>
    } @else if (cart.isError()) {
      <div class="notice error">
        <strong>Could not load the cart.</strong> {{ cart.error()?.message }}
        <p class="small">
          A 404 here means the cart was closed by an order on another device. The binding already
          dropped the id, so the next add-to-cart bootstraps a fresh one — no button needed.
        </p>
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
                  [disabled]="mutations.isPending()"
                  (click)="remove(l.id)"
                >
                  remove
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

      @if (mutations.error(); as e) {
        <div class="notice error" style="margin-top:1rem">
          <strong>Failed.</strong> {{ e.message }}
        </div>
      }
    }
  `,
})
export class CartPage {
  protected readonly money = money;

  /**
   * No cart id threaded through anywhere.
   *
   * `injectCart()` reads the stored id itself and re-keys when it changes, and it
   * drops a dead id on a 404. This component used to carry a signal, a
   * `subscribeAll` subscription and a «forget this cart» button for all of that.
   */
  protected readonly cart = injectCart();
  protected readonly mutations = injectCartMutations();

  protected readonly lines = computed(() => cartLines(this.cart.data()));
  protected readonly total = computed(() => cartTotal(this.cart.data()));

  private readonly emporix = injectEmporix();
  private readonly lineProductIds = computed(() =>
    this.lines()
      .map((l) => l.productId)
      .filter((id): id is string => id !== undefined && id !== ""),
  );
  private readonly names = productNamesQuery(this.lineProductIds);

  protected lineName(l: { name: string; productId: string }): string {
    // The snapshot wins when it has one — it is what the shopper saw when they
    // added the item, even if the product has been renamed since.
    return l.name !== "" ? l.name : (this.names.data()?.[l.productId] ?? l.productId);
  }

  protected async remove(itemId: string): Promise<void> {
    // The mutation invalidates the cart itself; no refetch call here.
    await this.mutations.removeItem(itemId).catch(() => {
      /* surfaced via mutations.error() */
    });
    void this.emporix;
  }
}
