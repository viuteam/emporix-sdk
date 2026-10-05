import { CategoryTree } from "../catalog/CategorySidebar";

export function Categories() {
  return (
    <div className="container page">
      <h1 className="page-title">All categories</h1>
      <CategoryTree />
    </div>
  );
}
