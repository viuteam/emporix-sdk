import { Component, computed } from "@angular/core";
import { priceQuery, productsQuery } from "../lib/queries";
import { ProductGrid } from "../ui/product-grid";
import { QueryState } from "../ui/query-state";

@Component({
  selector: "app-home",
  imports: [ProductGrid, QueryState],
  template: `
    <h1>Catalog</h1>
    @if (products.isPending() || products.isError()) {
      <app-query-state
        [fetchStatus]="products.fetchStatus()"
        [error]="products.error()"
        label="Could not load products."
        pendingLabel="Loading products…"
      />
    } @else {
      <app-product-grid
        [products]="items()"
        [prices]="prices.data()"
        [pricesLoading]="prices.isPending()"
      />
    }
  `,
})
export class Home {
  protected readonly products = productsQuery(12);
  protected readonly items = computed(() => this.products.data()?.items ?? []);

  /**
   * Prices for exactly the products on screen.
   *
   * Derived from `items`, so it re-resolves when the page changes or the
   * currency switches — and stays disabled while the list is empty, which keeps
   * the first render from making a pointless billed call.
   */
  protected readonly prices = priceQuery(this.items);
}
