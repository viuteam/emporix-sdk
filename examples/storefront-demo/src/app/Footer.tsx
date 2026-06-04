export function Footer({ tenant, onReset }: { tenant: string; onReset: () => void }) {
  return (
    <footer style={{ borderTop: "1px solid var(--line)", marginTop: "var(--s-8)" }}>
      <div
        className="container"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--s-3)",
          alignItems: "center",
          paddingBlock: "var(--s-5)",
          fontSize: "var(--step--1)",
        }}
      >
        <span className="muted">
          Emporix Storefront Demo · tenant <strong className="serif">{tenant}</strong>
        </span>
        <span className="muted" style={{ marginLeft: "var(--s-3)" }}>
          Built with <code>@viu/emporix-sdk-react</code>
        </span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onReset} style={{ marginLeft: "auto" }}>
          Change tenant
        </button>
      </div>
    </footer>
  );
}
