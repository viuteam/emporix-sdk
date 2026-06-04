export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="cluster" style={{ justifyContent: "center", padding: "var(--s-7) 0", color: "var(--muted)" }}>
      <Spinner label={label} />
      <span className="eyebrow">{label}</span>
    </div>
  );
}
