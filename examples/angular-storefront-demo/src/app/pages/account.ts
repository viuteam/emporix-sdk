import { Component, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { injectCustomerSession, injectEmporixSite } from "@viu/emporix-sdk-angular";
import { dateFmt, money, orderVM, type OrderVM } from "@viu/emporix-examples-shared";
import { injectMyOrders } from "@viu/emporix-sdk-angular";

@Component({
  selector: "app-account",
  imports: [RouterLink],
  templateUrl: "./account.html",
})
export class Account {
  protected readonly session = injectCustomerSession();
  protected readonly site = injectEmporixSite();
  /** The page, as a signal — read inside the query so changing it refetches. */
  protected readonly page = signal(1);
  protected readonly orders = injectMyOrders(
    computed(() => ({ pageNumber: this.page(), pageSize: 10 })),
  );

  protected readonly money = money;
  protected readonly dateFmt = dateFmt;

  /**
   * Orders through the shared adapter.
   *
   * `orderVM` exists because the order number lives under `orderNumber` on some
   * tenants and in a `generalAttributes` mixin on others — reading one field
   * directly renders a blank column for half of them.
   */
  protected readonly rows = computed<OrderVM[]>(() =>
    (this.orders.data()?.items ?? []).map(orderVM),
  );

  /** `contactEmail` is the field the generated Customer actually carries. */
  /** Emporix answers `hasNextPage` per page; no total is requested. */
  protected readonly hasNext = computed(() => this.orders.data()?.hasNextPage ?? false);

  protected prev(): void {
    this.page.update((p) => Math.max(1, p - 1));
  }

  protected next(): void {
    if (this.hasNext()) this.page.update((p) => p + 1);
  }

  protected readonly customerLabel = computed(
    () => this.session.customer()?.contactEmail ?? "…",
  );
}
