import { Component, computed, signal } from "@angular/core";
import { injectMatchPrices, injectProductsInfinite } from "@viu/emporix-sdk-angular";
import { priceMatchItems } from "@viu/emporix-examples-shared";
import { ProductGrid } from "../ui/product-grid";
import { QueryState } from "../ui/query-state";

@Component({
  selector: "app-home",
  imports: [ProductGrid, QueryState],
  templateUrl: "./home.html",
})
export class Home {
  /**
   * The catalog as an infinite query.
   *
   * `hasNextPage()` comes from Emporix's own `hasNextPage` on the last page, so
   * the «Load more» button disappears exactly when the server says there is
   * nothing left — no trailing empty request to discover the end.
   */
  protected readonly products = injectProductsInfinite(signal(12));

  /** Every page flattened. TanStack keeps the pages; the grid wants the items. */
  protected readonly items = computed(() =>
    (this.products.data()?.pages ?? []).flatMap((p) => p.items),
  );
  protected readonly pageCount = computed(() => this.products.data()?.pages.length ?? 0);

  /**
   * Prices for everything loaded so far.
   *
   * `priceMatchItems` is the shape Emporix wants; `injectMatchPrices` stays
   * disabled while it is empty, so the first render costs nothing. Loading a page
   * re-resolves the whole visible set in one call rather than one per page.
   */
  private readonly priceInput = computed(() => ({ items: priceMatchItems([...this.items()]) }));
  protected readonly prices = injectMatchPrices(this.priceInput);
}
