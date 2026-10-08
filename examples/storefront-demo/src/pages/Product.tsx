import { Link, useLocation, useParams } from "react-router-dom";
import { useProduct, useProductsByCodes } from "@viu/emporix-sdk-react";
import {
  catId,
  productName,
  productDescription,
  productImages,
  isVariantParent,
  dynamicVariantRootId,
  needsVariantChoice,
  sellableVariantCodes,
} from "../lib/adapters";
import { usePrices } from "../lib/usePrices";
import { money } from "@viu/emporix-examples-shared";
import { ProductGallery } from "../catalog/ProductGallery";
import { DynamicVariantPicker, VariantPicker } from "../catalog/VariantPicker";
import { AddToCartBar } from "../catalog/AddToCartBar";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Product() {
  const { idOrCode } = useParams();
  const id = idOrCode ?? "";
  // Set by DynamicVariantPicker when it switches variants: the tree stays the same.
  const pickerRootId = (useLocation().state as { variantRootId?: string } | null)?.variantRootId;
  const { data: loaded, isLoading, isError } = useProduct(id);
  const rootId = loaded ? dynamicVariantRootId(loaded) : pickerRootId;
  // The root of a dynamic-variant tree holds the selectors. Without one this is the
  // query above again (same key), so it costs no extra request.
  const { data: root } = useProduct(rootId ?? id);
  // The root's map only names its variants (see sellableVariantCodes); their attributes come with them.
  const { data: variants } = useProductsByCodes(rootId && root ? sellableVariantCodes(root) : []);
  // A variant the picker switched to renders from that list at once; its own request
  // replaces it when it answers. Without this the whole page swaps to a spinner.
  const product = loaded ?? variants?.find((v) => catId(v) === id);
  const priceOf = usePrices(product ? [product] : []);
  // One match for all variants, so a switch finds its price without waiting.
  const variantPriceOf = usePrices(variants ?? []);

  if (!product && isLoading) {
    return (
      <div className="container">
        <Loading label="Loading product" />
      </div>
    );
  }
  if (isError || !product) {
    return (
      <div className="container">
        <EmptyState title="Product not found">
          This product isn’t available — <Link to="/" className="u-underline">back to the catalogue</Link>.
        </EmptyState>
      </div>
    );
  }

  const name = productName(product);
  const desc = productDescription(product);
  const price = priceOf(id) ?? variantPriceOf(id);
  // On a dynamic variant the selectors say which colour and size this is, so the
  // title is the root's; the variant's own name still goes to the cart.
  const title = rootId && root ? productName(root) : name;

  const code = (product as { code?: string }).code;

  return (
    <div className="container page">
      <p className="back-link">
        <Link to="/" className="u-underline">
          ← Catalogue
        </Link>
      </p>
      <div className="pdp__grid">
        <ProductGallery media={productImages(product)} alt={name} />
        <div className="pdp__info">
          {code ? <p className="pc__code">Art. {code}</p> : null}
          <h1 className="pdp__title">{title}</h1>
          {price ? (
            <p className="price pdp__price">{money(price.amount, price.currency)}</p>
          ) : (
            <p className="pc__noprice">No price in this context</p>
          )}
          {desc ? (
            // Description may contain merchant HTML — render it (sanitized in
            // `productDescription`) rather than stripping the markup.
            <div className="pdp__desc" dangerouslySetInnerHTML={{ __html: desc }} />
          ) : null}
          {/* Only a PARENT_VARIANT has variant children; for any other type the
              children request could only come back empty. */}
          {isVariantParent(product) ? <VariantPicker productId={id} /> : null}
          {rootId && variants ? <DynamicVariantPicker key={id} variants={variants} current={product} /> : null}
          <AddToCartBar
            productId={id}
            productName={name}
            price={price}
            blockedHint={needsVariantChoice(product) ? "Choose a variant to add it to the cart." : undefined}
          />
        </div>
      </div>
    </div>
  );
}
