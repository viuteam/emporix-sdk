export function Footer({ tenant, onReset }: { tenant: string; onReset: () => void }) {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span className="muted">
          Emporix Storefront Demo · tenant <strong>{tenant}</strong>
        </span>
        <span className="muted">
          Built with <code>@viu/emporix-sdk-react</code>
        </span>
        <button type="button" className="btn btn--ghost btn--sm site-footer__reset" onClick={onReset}>
          Change setup
        </button>
      </div>
    </footer>
  );
}
