import { useSearchParams } from "react-router-dom";
import { useProductSearch } from "@viu/emporix-sdk-react";
import { ProductGrid } from "../catalog/ProductGrid";
import { usePrices } from "../lib/usePrices";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";

export function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, isLoading, isFetching } = useProductSearch(q, { pageSize: 24 });
  const products = data?.items ?? [];
  const priceOf = usePrices(products);

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Search</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        {q ? `“${q}”` : "Search the catalogue"}
      </h2>
      {!q ? (
        <EmptyState title="Search the catalogue">Type a query in the header.</EmptyState>
      ) : isLoading || isFetching ? (
        <Loading />
      ) : products.length === 0 ? (
        <EmptyState title="No matches">Nothing found for “{q}”.</EmptyState>
      ) : (
        <ProductGrid products={products} priceOf={priceOf} />
      )}
    </div>
  );
}
