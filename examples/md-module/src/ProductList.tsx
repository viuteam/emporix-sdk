import { useProducts } from "@viu/emporix-sdk-react";

/**
 * `totalCount: true` asks Emporix for X-Total-Count, so a dashboard table can
 * show "X of Y" and page exactly instead of guessing from a full page.
 */
export function ProductList(): React.JSX.Element {
  const { data, isLoading, error } = useProducts({
    pageNumber: 1,
    pageSize: 20,
    totalCount: true,
  });

  if (isLoading) return <p>Loading…</p>;
  if (error) return <pre>{String(error)}</pre>;

  return (
    <section>
      <h1>
        Products{" "}
        {data?.totalCount !== undefined ? `(${data.items.length} of ${data.totalCount})` : ""}
      </h1>
      <ul>
        {data?.items.map((p) => (
          <li key={p.id}>{typeof p.name === "string" ? p.name : p.id}</li>
        ))}
      </ul>
    </section>
  );
}
