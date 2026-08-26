import { Component, computed, signal } from "@angular/core";
import { injectMatchPrices, injectProductNameSearch } from "@viu/emporix-sdk-angular";
import { priceMatchItems } from "@viu/emporix-examples-shared";
import { ProductGrid } from "../ui/product-grid";
import { QueryState } from "../ui/query-state";

@Component({
  selector: "app-search",
  imports: [ProductGrid, QueryState],
  templateUrl: "./search.html",
})
export class Search {
  /**
   * The search term as a signal, read inside the query's options callback.
   *
   * This is the whole reactivity story in one place: typing re-keys the query
   * and re-runs it, with no `effect`, subscription or manual refetch involved.
   */
  protected readonly term = signal("");
  /** The term search, not `injectProductSearch` — that one takes a built filter. */
  protected readonly results = injectProductNameSearch(
    this.term.asReadonly(),
    signal({ pageSize: 24 }),
  );
  protected readonly items = computed(() => this.results.data()?.items ?? []);
  private readonly priceInput = computed(() => ({ items: priceMatchItems([...this.items()]) }));
  protected readonly prices = injectMatchPrices(this.priceInput);
}
