import { Component, computed, signal } from "@angular/core";
import { priceQuery, productSearchQuery } from "../lib/queries";
import { ProductGrid } from "../ui/product-grid";
import { QueryState } from "../ui/query-state";

@Component({
  selector: "app-search",
  imports: [ProductGrid, QueryState],
  template: `
    <h1>Search</h1>
    <label style="max-width:420px">
      <span>Product name</span>
      <input
        type="search"
        [value]="term()"
        (input)="term.set($any($event.target).value)"
        placeholder="Type at least one character"
      />
    </label>

    @if (term().trim() === "") {
      <p class="muted">
        Nothing is requested until you type — the query is gated on the term, so an empty
        search costs no API call.
      </p>
    } @else if (results.isPending() || results.isError()) {
      <app-query-state
        [fetchStatus]="results.fetchStatus()"
        [error]="results.error()"
        label="Search failed."
        pendingLabel="Searching…"
      />
    } @else {
      <p class="muted small">{{ items().length }} result(s)</p>
      <app-product-grid
        [products]="items()"
        [prices]="prices.data()"
        [pricesLoading]="prices.isPending()"
      />
    }
  `,
})
export class Search {
  /**
   * The search term as a signal, read inside the query's options callback.
   *
   * This is the whole reactivity story in one place: typing re-keys the query
   * and re-runs it, with no `effect`, subscription or manual refetch involved.
   */
  protected readonly term = signal("");
  protected readonly results = productSearchQuery(this.term.asReadonly());
  protected readonly items = computed(() => this.results.data()?.items ?? []);
  protected readonly prices = priceQuery(this.items);
}
