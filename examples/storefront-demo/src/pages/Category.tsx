import { Link, useParams } from "react-router-dom";
import { useCategory, useProductsInCategoryInfinite, useSubcategories } from "@viu/emporix-sdk-react";
import { ProductGrid } from "../catalog/ProductGrid";
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
    <div className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Category</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        {category ? catLabel(category) : "…"}
      </h2>

      {subcats.length > 0 ? (
        <nav
          className="catnav"
          aria-label="Subcategories"
          style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", marginBottom: "var(--s-6)" }}
        >
          {subcats.map((s) => (
            <Link key={catId(s)} to={`/category/${encodeURIComponent(catId(s))}`} className="u-underline">
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
        // Pure parent category (only subcategories) → tiles above are enough.
        subcats.length > 0 ? null : <EmptyState title="No products in this category" />
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
