import { Component, computed, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import {
  imageOf,
  money,
  priceForProduct,
  productName,
  type PriceVM,
} from "@viu/emporix-examples-shared";
import type { PriceMatch, Product } from "@viu/emporix-sdk";

/**
 * A grid of product cards with resolved prices.
 *
 * Prices arrive separately from products, because Emporix resolves price by
 * currency, site and target location — a price belongs to a product *in a
 * context*, not to the product. The grid takes both and joins them by id, using
 * the shared adapter so the two wire shapes (`itemId` live, `itemRef` in the
 * generated type) are both handled.
 */
@Component({
  selector: "app-product-grid",
  imports: [RouterLink],
  templateUrl: "./product-grid.html",
})
export class ProductGrid {
  readonly products = input.required<readonly Product[]>();
  readonly prices = input<PriceMatch[] | undefined>(undefined);
  readonly pricesLoading = input(false);

  protected readonly money = money;

  private readonly matches = computed(() => this.prices());

  protected price(p: Product): PriceVM | undefined {
    const id = (p as { id?: string }).id;
    return id === undefined ? undefined : priceForProduct(this.matches(), id);
  }

  protected name(p: Product): string {
    return productName(p);
  }

  protected image(p: Product): string | undefined {
    // `productMedia`, not `media`. Reading the wrong field is why every card in
    // this grid said «no image» against the live tenant — the DTO carries one and
    // not the other, and both are optional so nothing complains.
    return imageOf((p as { productMedia?: Parameters<typeof imageOf>[0] }).productMedia);
  }
}
