import { Component, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { injectCustomerSession, injectEmporixSite } from "@viu/emporix-sdk-angular";
import { dateFmt, money, orderVM, type OrderVM } from "@viu/emporix-examples-shared";
import { myOrdersQuery } from "../lib/queries";

@Component({
  selector: "app-account",
  imports: [RouterLink],
  template: `
    <h1>Account</h1>

    @if (!session.isAuthenticated()) {
      <p class="muted">Not signed in. <a routerLink="/login">Sign in →</a></p>
      <p class="small muted">
        Nothing on this page issues a request while you are a guest: the orders read uses
        <code>mode: "customer"</code>, which keys the query but leaves it disabled without a
        token.
      </p>
    } @else {
      <div class="card stack">
        <div class="row-between">
          <div>
            <div class="small muted">Signed in</div>
            <strong>{{ customerLabel() }}</strong>
          </div>
          @if (session.isLoading()) {
            <span class="muted small">loading profile…</span>
          }
        </div>
        @if (site.siteCode(); as s) {
          <div class="small muted">Active site {{ s }} · {{ site.currency() ?? "—" }}</div>
        }
        <div><a routerLink="/account/credentials">Password and login email →</a></div>
        @if (session.saasToken()) {
          <div class="small muted">
            A SaaS token is held in this session — customer checkout needs it, and it cannot be
            re-minted by a refresh.
          </div>
        }
      </div>

      <h2>Orders</h2>
      @if (orders.isPending()) {
        <p class="muted">Loading orders…</p>
      } @else if (orders.isError()) {
        <div class="notice error">
          <strong>Could not load orders.</strong> {{ orders.error()?.message }}
        </div>
      } @else if (rows().length === 0) {
        <p class="muted">No orders yet.</p>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Status</th>
              <th>Items</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            @for (o of rows(); track o.id) {
              <tr>
                <td>{{ o.number }}</td>
                <td>{{ o.createdAt ? dateFmt(o.createdAt) : "—" }}</td>
                <td>{{ o.status }}</td>
                <td>{{ o.itemCount }}</td>
                <td>
                  @if (o.total; as t) {
                    {{ money(t.amount, t.currency) }}
                  } @else {
                    —
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        <div class="row-between" style="margin-top:1rem">
          <button type="button" [disabled]="page() === 1 || orders.isFetching()" (click)="prev()">
            ← Newer
          </button>
          <span class="muted small">
            Page {{ page() }}@if (orders.isFetching()) { · loading… }
          </span>
          <button type="button" [disabled]="!hasNext() || orders.isFetching()" (click)="next()">
            Older →
          </button>
        </div>
      }
    }
  `,
})
export class Account {
  protected readonly session = injectCustomerSession();
  protected readonly site = injectEmporixSite();
  /** The page, as a signal — read inside the query so changing it refetches. */
  protected readonly page = signal(1);
  protected readonly orders = myOrdersQuery(this.page.asReadonly(), 10);

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
