import { Link, useParams } from "react-router-dom";
import { useProduct } from "@viu/emporix-sdk-react";
import { productName, productDescription, productImages } from "../lib/adapters";
import { usePrices } from "../lib/usePrices";
import { money } from "@viu/emporix-examples-shared";
import { ProductGallery } from "../catalog/ProductGallery";
import { VariantPicker } from "../catalog/VariantPicker";
import { AddToCartBar } from "../catalog/AddToCartBar";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Product() {
  const { idOrCode } = useParams();
  const id = idOrCode ?? "";
  const { data: product, isLoading, isError } = useProduct(id);
  const priceOf = usePrices(product ? [product] : []);

  if (isLoading) {
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
  const price = priceOf(id);

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
          <h1 className="pdp__title">{name}</h1>
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
          <VariantPicker productId={id} />
          <AddToCartBar productId={id} productName={name} price={price} />
        </div>
      </div>
    </div>
  );
}
