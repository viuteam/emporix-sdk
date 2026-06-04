export function Placeholder({ title }: { title: string }) {
  return (
    <div className="container" style={{ paddingBlock: "var(--s-7)" }}>
      <p className="eyebrow">Coming up</p>
      <h2 className="serif" style={{ marginTop: "var(--s-2)" }}>
        {title}
      </h2>
      <p className="muted" style={{ marginTop: "var(--s-3)" }}>
        This section is implemented in a later task.
      </p>
    </div>
  );
}
