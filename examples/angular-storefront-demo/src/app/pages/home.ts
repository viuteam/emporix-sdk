import { Component, computed } from "@angular/core";
import { priceQuery, productsInfinite } from "../lib/queries";
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

      <div class="row-between" style="margin-top:1.5rem">
        <span class="muted small">
          {{ items().length }} product(s) over {{ pageCount() }} page(s)
        </span>
        @if (products.hasNextPage()) {
          <button
            type="button"
            [disabled]="products.isFetchingNextPage()"
            (click)="products.fetchNextPage()"
          >
            {{ products.isFetchingNextPage() ? "Loading…" : "Load more" }}
          </button>
        } @else {
          <span class="muted small">End of catalog.</span>
        }
      </div>
    }
  `,
})
export class Home {
  /**
   * The catalog as an infinite query.
   *
   * `hasNextPage()` comes from Emporix's own `hasNextPage` on the last page, so
   * the «Load more» button disappears exactly when the server says there is
   * nothing left — no trailing empty request to discover the end.
   */
  protected readonly products = productsInfinite(12);

  /** Every page flattened. TanStack keeps the pages; the grid wants the items. */
  protected readonly items = computed(() =>
    (this.products.data()?.pages ?? []).flatMap((p) => p.items),
  );
  protected readonly pageCount = computed(() => this.products.data()?.pages.length ?? 0);

  /**
   * Prices for everything loaded so far.
   *
   * Derived from `items`, so loading another page re-resolves prices for the
   * whole visible set in one call rather than one per page — and a currency
   * switch re-resolves without re-fetching the catalog.
   */
  protected readonly prices = priceQuery(this.items);
}
