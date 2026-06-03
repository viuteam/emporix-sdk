import { Button } from "./components/ui/Button";
import { Field, SelectField } from "./components/ui/Field";
import { Tag } from "./components/ui/Tag";
import { Loading } from "./components/ui/Spinner";
import { EmptyState } from "./components/ui/EmptyState";

// Temporary design-system showcase — replaced by the router in Task 4.
export function App() {
  return (
    <main className="container" style={{ paddingBlock: "var(--s-7)" }}>
      <p className="eyebrow reveal">Emporix · Storefront Demo</p>
      <h1 className="reveal" style={{ marginBlock: "var(--s-3) var(--s-5)" }}>
        Editorial <span style={{ fontStyle: "italic", color: "var(--oxblood)" }}>Luxe</span>
        <br /> design system
      </h1>
      <hr className="rule" />

      <section className="stack reveal" style={{ marginTop: "var(--s-6)" }}>
        <div className="cluster">
          <Button variant="accent">Add to bag</Button>
          <Button variant="solid">Checkout</Button>
          <Button variant="outline">Continue</Button>
          <Button variant="ghost">Cancel</Button>
          <Tag accent>New</Tag>
          <Tag>Knitwear</Tag>
          <span className="price" style={{ fontSize: "var(--step-1)" }}>CHF 189.00</span>
        </div>

        <div style={{ maxWidth: "26rem" }} className="stack">
          <Field label="Email" type="email" placeholder="you@example.com" />
          <Field label="Password" type="password" error="Required" />
          <SelectField label="Site">
            <option>main</option>
            <option>secondary</option>
          </SelectField>
        </div>

        <Loading label="Loading catalogue" />
        <EmptyState title="Nothing here yet">Your bag is empty — discover the new season.</EmptyState>
      </section>
    </main>
  );
}
