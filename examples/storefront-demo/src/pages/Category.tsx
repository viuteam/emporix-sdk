import { useParams } from "react-router-dom";
import { useCategory, useProductsInCategoryInfinite } from "@viu/emporix-sdk-react";
import { ProductGrid } from "../catalog/ProductGrid";
import { usePrices } from "../lib/usePrices";
import { catLabel } from "../lib/adapters";
import { Button } from "../components/ui/Button";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Category() {
  const { id } = useParams();
  const categoryId = id ?? "";
  const { data: category } = useCategory(categoryId);
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useProductsInCategoryInfinite(categoryId, { pageSize: 24 });
  const products = data?.pages.flatMap((pg) => pg.items) ?? [];
  const priceOf = usePrices(products);

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Category</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        {category ? catLabel(category) : "…"}
      </h2>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <EmptyState title="Couldn't load this category" />
      ) : products.length === 0 ? (
        <EmptyState title="No products in this category" />
      ) : (
        <>
          <ProductGrid products={products} priceOf={priceOf} />
          {hasNextPage ? (
            <div className="center-col" style={{ marginTop: "var(--s-6)" }}>
              <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
