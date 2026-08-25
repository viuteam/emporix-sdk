import { Component, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import {
  injectActiveCart,
  injectCartMutations,
  injectEmporix,
  injectMatchPrices,
  injectProduct,
  injectProductMedia,
} from "@viu/emporix-sdk-angular";
import {
  money,
  pickText,
  priceForProduct,
  priceMatchItems,
  productName,
  productYrn,
  stripHtml,
  type PriceVM,
} from "@viu/emporix-examples-shared";

@Component({
  selector: "app-product",
  imports: [RouterLink],
  template: `
    <p class="small"><a routerLink="/">← Catalog</a></p>

    @if (product.isPending()) {
      <p class="muted">Loading…</p>
    } @else if (product.isError()) {
      <div class="notice error">
        <strong>Product not found.</strong> {{ product.error()?.message }}
      </div>
    } @else if (product.data(); as p) {
      <div class="stack" style="max-width:640px">
        <h1>{{ productName(p) }}</h1>
        <p class="muted small">{{ p.code }}</p>
        <div class="thumb" style="max-width:420px">
          @if (image(); as src) {
            <img [src]="src" [alt]="productName(p)" />
          } @else {
            <span class="muted small">
              {{ product.isPending() ? "loading…" : "no image" }}
            </span>
          }
        </div>
        @if (description(p); as d) {
          <p>{{ d }}</p>
        }
        <p>
          @if (price(); as vm) {
            <strong>{{ money(vm.amount, vm.currency) }}</strong>
          } @else if (prices.isPending()) {
            <span class="muted">resolving price…</span>
          } @else {
            <span class="muted">price unavailable in this context</span>
          }
        </p>

        <div class="row-between card">
          <label style="margin:0; max-width:120px">
            <span>Quantity</span>
            <input
              type="number"
              min="1"
              [value]="qty()"
              (input)="setQty($any($event.target).value)"
            />
          </label>
          <button
            class="primary"
            type="button"
            [disabled]="mutations.isPending() || !purchasable()"
            (click)="add()"
          >
            {{ mutations.isPending() ? "Adding…" : "Add to cart" }}
          </button>
        </div>

        @if (!purchasable() && !prices.isPending()) {
          <div class="notice">
            Not purchasable in this context. Emporix requires a <code>priceId</code> on
            internal-type cart items, so a product with no matched price cannot be added — the
            API would answer 400.
          </div>
        }
        @if (mutations.error(); as e) {
          <div class="notice error"><strong>Could not add to cart.</strong> {{ e.message }}</div>
        }
        @if (added()) {
          <div class="notice">In the cart. <a routerLink="/cart">Go to cart →</a></div>
        }
      </div>
    }
  `,
})
export class ProductPage {
  private readonly emporix = injectEmporix();
  private readonly route = inject(ActivatedRoute);

  protected readonly money = money;
  protected readonly productName = productName;

  /** From the observable, not a snapshot: Angular reuses the component per id. */
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly productId = computed(() => this.params().get("id") ?? "");

  protected readonly product = injectProduct(this.productId);
  /** Derived from the product DTO — the Media Service needs a server-only scope. */
  private readonly media = injectProductMedia(this.productId);

  private readonly priceInput = computed(() => {
    const p = this.product.data();
    return { items: p === undefined ? [] : priceMatchItems([p]) };
  });
  protected readonly prices = injectMatchPrices(this.priceInput);

  /**
   * The cart, created on demand.
   *
   * Reading it here is what bootstraps one, so `injectCartMutations` finds an id
   * by the time the shopper clicks. The mutation resolves the id at call time, so
   * a race between the two is not possible.
   */
  private readonly activeCart = injectActiveCart({ create: true });
  protected readonly mutations = injectCartMutations();

  protected readonly price = computed<PriceVM | undefined>(() =>
    priceForProduct(this.prices.data(), this.productId()),
  );
  /** Only priced products can be added — see the notice in the template. */
  protected readonly purchasable = computed(() => this.price()?.priceId !== undefined);

  protected readonly image = computed(
    () => (this.media()?.[0] as { url?: string } | undefined)?.url,
  );

  protected readonly qty = signal(1);
  protected readonly added = signal(false);

  protected setQty(raw: string): void {
    this.qty.set(Math.max(1, Number(raw) || 1));
  }

  protected description(p: unknown): string {
    return stripHtml(pickText((p as { description?: unknown }).description));
  }

  /**
   * Add to cart.
   *
   * The whole body is now the payload. The cart bootstrap, the id resolution, the
   * auth context and the invalidation all live in the bindings — this component
   * used to carry every one of them.
   *
   * What it still owns is the `price` row: Emporix requires `priceId` on
   * internal-type items, so an unpriced product cannot be added at all.
   */
  protected async add(): Promise<void> {
    const vm = this.price();
    if (vm?.priceId === undefined) return;
    this.added.set(false);
    void this.activeCart.data();
    try {
      await this.mutations.addItem({
        itemYrn: productYrn(this.emporix.client.tenant, this.productId()),
        quantity: this.qty(),
        price: {
          priceId: vm.priceId,
          originalAmount: vm.amount,
          effectiveAmount: vm.amount,
          currency: vm.currency,
        },
      } as never);
      this.added.set(true);
    } catch {
      // `mutations.error()` carries it; the template renders that.
    }
  }
}
