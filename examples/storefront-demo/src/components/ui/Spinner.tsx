export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading">
      <Spinner label={label} />
      <span>{label}</span>
    </div>
  );
}
