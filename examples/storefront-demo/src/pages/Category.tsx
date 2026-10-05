import { Link, useParams } from "react-router-dom";
import { useCategory, useProductsInCategoryInfinite, useSubcategories } from "@viu/emporix-sdk-react";
import { ProductGrid } from "../catalog/ProductGrid";
import { CategorySidebar } from "../catalog/CategorySidebar";
import { usePrices } from "../lib/usePrices";
import { catId, catLabel } from "../lib/adapters";
import { Button } from "../components/ui/Button";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Category() {
  const { id } = useParams();
  const categoryId = id ?? "";
  const { data: category } = useCategory(categoryId);
  const { data: subs } = useSubcategories(categoryId, { pageSize: 50 });
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useProductsInCategoryInfinite(categoryId, { pageSize: 24 });
  const products = data?.pages.flatMap((pg) => pg.items) ?? [];
  const subcats = subs ?? [];
  const priceOf = usePrices(products);

  return (
    <div className="container with-sidebar">
      <CategorySidebar activeId={categoryId} />
      <section>
        <h1 className="page-title">{category ? catLabel(category) : "…"}</h1>
        {subcats.length > 0 ? (
          <nav className="chips" aria-label="Subcategories">
            {subcats.map((s) => (
              <Link key={catId(s)} to={`/category/${encodeURIComponent(catId(s))}`} className="tag">
                {catLabel(s)}
              </Link>
            ))}
          </nav>
        ) : null}

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <EmptyState title="Couldn't load this category" />
        ) : products.length === 0 ? (
          // Pure parent category (only subcategories) → the chips above are enough.
          subcats.length > 0 ? null : <EmptyState title="No products in this category" />
        ) : (
          <>
            <ProductGrid products={products} priceOf={priceOf} />
            {hasNextPage ? (
              <div className="load-more">
                <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
