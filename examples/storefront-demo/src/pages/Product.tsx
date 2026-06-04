import { Link, useParams } from "react-router-dom";
import { useProduct } from "@viu/emporix-sdk-react";
import { productName, productDescription, productImages } from "../lib/adapters";
import { usePrices } from "../lib/usePrices";
import { money } from "../lib/format";
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

  return (
    <div className="container pdp" style={{ paddingBlock: "var(--s-6)" }}>
      <p style={{ marginBottom: "var(--s-5)" }}>
        <Link to="/" className="eyebrow u-underline">← Catalogue</Link>
      </p>
      <div className="pdp__grid">
        <ProductGallery media={productImages(product)} alt={name} />
        <div className="pdp__info">
          <h1 className="serif" style={{ fontSize: "var(--step-3)" }}>{name}</h1>
          {price ? (
            <p className="price" style={{ fontSize: "var(--step-2)", marginTop: "var(--s-3)" }}>
              {money(price.amount, price.currency)}
            </p>
          ) : null}
          {desc ? <p className="muted" style={{ marginTop: "var(--s-4)", maxWidth: "52ch" }}>{desc}</p> : null}
          <VariantPicker productId={id} />
          <AddToCartBar productId={id} productName={name} price={price} />
        </div>
      </div>
    </div>
  );
}
