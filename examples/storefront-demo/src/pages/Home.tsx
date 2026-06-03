import { useProducts } from "@viu/emporix-sdk-react";
import { Hero } from "../catalog/Hero";
import { CategoryNav } from "../catalog/CategoryNav";
import { ProductGrid } from "../catalog/ProductGrid";
import { usePrices } from "../lib/usePrices";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Home() {
  const { data, isLoading, isError } = useProducts({ pageSize: 12 });
  const products = data?.items ?? [];
  const priceOf = usePrices(products);

  return (
    <div className="container">
      <Hero />
      <CategoryNav />
      <div className="section-head">
        <h2 className="serif">Featured</h2>
        {products.length > 0 ? <span className="eyebrow">{products.length} pieces</span> : null}
      </div>
      {isLoading ? (
        <Loading label="Loading catalogue" />
      ) : isError ? (
        <EmptyState title="Couldn't load products">
          Check the tenant and storefront client id (footer → change tenant).
        </EmptyState>
      ) : products.length === 0 ? (
        <EmptyState title="No products yet">This tenant has no published products.</EmptyState>
      ) : (
        <ProductGrid products={products} priceOf={priceOf} lead />
      )}
    </div>
  );
}
