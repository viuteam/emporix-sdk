import { Component, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { auth, type Cart } from "@viu/emporix-sdk";
import { injectEmporix, injectEmporixSite } from "@viu/emporix-sdk-angular";
import {
  imageOf,
  money,
  priceForProduct,
  productName,
  productYrn,
  stripHtml,
  pickText,
  type PriceVM,
} from "@viu/emporix-examples-shared";
import { priceQuery, productQuery } from "../lib/queries";

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
          @if (image(p); as src) {
            <img [src]="src" [alt]="productName(p)" />
          } @else {
            <span class="muted small">no image</span>
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
            [disabled]="adding() || !purchasable()"
            (click)="add()"
          >
            {{ adding() ? "Adding…" : "Add to cart" }}
          </button>
        </div>

        @if (!purchasable() && !prices.isPending()) {
          <div class="notice">
            Not purchasable in this context. Emporix requires a <code>priceId</code> on
            internal-type cart items, so a product with no matched price cannot be added — the
            API would answer 400. Surfacing it here beats letting the button fail.
          </div>
        }
        @if (addError(); as e) {
          <div class="notice error"><strong>Could not add to cart.</strong> {{ e }}</div>
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
  private readonly site = injectEmporixSite();
  private readonly route = inject(ActivatedRoute);

  protected readonly money = money;
  protected readonly productName = productName;

  /**
   * The route param as a signal.
   *
   * From the observable, not a snapshot: Angular reuses the component when only
   * the id changes, so a snapshot read would leave the page showing the previous
   * product.
   */
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly productId = computed(() => this.params().get("id") ?? "");

  protected readonly product = productQuery(this.productId);
  private readonly asList = computed(() => {
    const p = this.product.data();
    return p === undefined ? [] : [p];
  });
  protected readonly prices = priceQuery(this.asList);

  protected readonly price = computed<PriceVM | undefined>(() =>
    priceForProduct(this.prices.data(), this.productId()),
  );
  /** Only priced products can be added — see the notice in the template. */
  protected readonly purchasable = computed(() => this.price()?.priceId !== undefined);

  protected readonly qty = signal(1);
  protected readonly adding = signal(false);
  protected readonly added = signal(false);
  protected readonly addError = signal<string | null>(null);

  protected setQty(raw: string): void {
    this.qty.set(Math.max(1, Number(raw) || 1));
  }

  protected image(p: unknown): string | undefined {
    return imageOf((p as { media?: Parameters<typeof imageOf>[0] }).media);
  }

  protected description(p: unknown): string {
    return stripHtml(pickText((p as { description?: unknown }).description));
  }

  /**
   * Add to cart, creating the cart if there is none.
   *
   * This is the shape a package-level `injectCartMutations` will formalise.
   * Three details it has to keep:
   *
   * - `getCurrent({ create: true })` returns a `Cart` with `.id`. Only
   *   `create()` returns `CartCreated` with `.cartId`; the two are not
   *   interchangeable.
   * - The item needs its matched `price` row, not just a quantity. Emporix
   *   requires `priceId` on internal-type items.
   * - The resulting cart id goes into storage, which is what makes the header
   *   badge and the cart page pick it up — they subscribe to that key.
   */
  protected async add(): Promise<void> {
    const vm = this.price();
    const productId = this.productId();
    if (vm?.priceId === undefined || productId === "") return;

    this.addError.set(null);
    this.added.set(false);
    this.adding.set(true);
    try {
      const token = this.emporix.storage.getCustomerToken();
      const ctx = token !== null ? auth.customer(token) : auth.anonymous();
      const siteCode = this.site.siteCode();
      let cartId = this.emporix.storage.getCartId();
      if (cartId === null) {
        if (siteCode === null) throw new Error("no active site — a cart is always site-bound");
        // `Cart | null`: getCurrent can answer "no cart" even with create:true.
        const cart: Cart | null = await this.emporix.client.carts.getCurrent(ctx, {
          siteCode,
          create: true,
        });
        cartId = cart?.id ?? null;
        if (cartId === null) throw new Error("cart could not be created");
        this.emporix.storage.setCartId(cartId);
      }
      await this.emporix.client.carts.addItem(
        cartId,
        {
          itemYrn: productYrn(this.emporix.client.tenant, productId),
          quantity: this.qty(),
          price: {
            priceId: vm.priceId,
            originalAmount: vm.amount,
            effectiveAmount: vm.amount,
            currency: vm.currency,
          },
        } as never,
        ctx,
      );
      this.added.set(true);
    } catch (e) {
      this.addError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.adding.set(false);
    }
  }
}
