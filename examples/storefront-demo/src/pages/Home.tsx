import type { Product } from "@viu/emporix-sdk";
import { useActiveSite, useProducts, useProductsInCategory } from "@viu/emporix-sdk-react";
import { CategoryNav } from "../catalog/CategoryNav";
import { ProductGrid } from "../catalog/ProductGrid";
import { usePrices } from "../lib/usePrices";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Home({ tenant, featuredCategoryId }: { tenant: string; featuredCategoryId?: string | undefined }) {
  const site = useActiveSite();
  return (
    <div className="container home">
      <p className="muted home__intro">
        Live demo on tenant <strong>{tenant}</strong>
        {site ? (
          <>
            {" "}
            · site <strong>{site.name}</strong>
          </>
        ) : null}
        . Catalogue, cart, checkout and account all run against it.
      </p>
      <CategoryNav />
      {featuredCategoryId ? <FeaturedCategory id={featuredCategoryId} /> : <FeaturedFirst />}
    </div>
  );
}

// Two components because a hook cannot be skipped: each fetches exactly one list.
function FeaturedCategory({ id }: { id: string }) {
  const { data, isLoading, isError } = useProductsInCategory(id, { pageSize: 12 });
  return <Featured products={data?.items ?? []} isLoading={isLoading} isError={isError} />;
}

function FeaturedFirst() {
  const { data, isLoading, isError } = useProducts({ pageSize: 12 });
  return <Featured products={data?.items ?? []} isLoading={isLoading} isError={isError} />;
}

function Featured({ products, isLoading, isError }: { products: Product[]; isLoading: boolean; isError: boolean }) {
  const priceOf = usePrices(products);
  return (
    <section>
      <div className="section-head">
        <h2>Featured</h2>
      </div>
      {isLoading ? (
        <Loading label="Loading products" />
      ) : isError ? (
        <EmptyState title="Couldn't load products">Check the tenant and storefront client id (footer → Change setup).</EmptyState>
      ) : products.length === 0 ? (
        <EmptyState title="No products yet">This tenant or category has no published products.</EmptyState>
      ) : (
        <ProductGrid products={products} priceOf={priceOf} />
      )}
    </section>
  );
}
