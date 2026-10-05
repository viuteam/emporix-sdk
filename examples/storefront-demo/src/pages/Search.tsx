import { useSearchParams } from "react-router-dom";
import { useProductNameSearch } from "@viu/emporix-sdk-react";
import { ProductGrid } from "../catalog/ProductGrid";
import { CategorySidebar } from "../catalog/CategorySidebar";
import { usePrices } from "../lib/usePrices";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  // useProductNameSearch builds the Emporix `name:(~…)` filter from free text.
  const { data, isLoading, isFetching } = useProductNameSearch(q.trim() ? q : "", { pageSize: 24 });
  const products = data?.items ?? [];
  const priceOf = usePrices(products);

  return (
    <div className="container with-sidebar">
      <CategorySidebar />
      <section>
        <h1 className="page-title">{q ? `Results for “${q}”` : "Search"}</h1>
        {!q ? (
          <EmptyState title="Search the catalogue">Type a query in the header.</EmptyState>
        ) : isLoading || isFetching ? (
          <Loading />
        ) : products.length === 0 ? (
          <EmptyState title="No matches">Nothing found for “{q}”.</EmptyState>
        ) : (
          <ProductGrid products={products} priceOf={priceOf} />
        )}
      </section>
    </div>
  );
}
