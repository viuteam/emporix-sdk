import { useSyncExternalStore, useState } from "react";
import { subscribeTelemetry, getTelemetry } from "./telemetry-store";

export function TelemetryHUD() {
  const events = useSyncExternalStore(subscribeTelemetry, getTelemetry, getTelemetry);
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "fixed", left: "var(--gutter)", bottom: "var(--s-5)", zIndex: 40 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn--outline btn--sm"
        style={{ background: "var(--paper)" }}
        aria-expanded={open}
      >
        ◴ telemetry {events.length ? `(${events.length})` : ""}
      </button>
      {open ? (
        <div
          className="surface"
          style={{
            position: "absolute",
            bottom: "calc(100% + var(--s-2))",
            left: 0,
            width: "min(86vw, 24rem)",
            maxHeight: "50vh",
            overflow: "auto",
            padding: "var(--s-3)",
            boxShadow: "var(--shadow-2)",
            fontSize: "var(--step--2)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {events.length === 0 ? (
            <p className="muted">No events yet — interact with the store.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
              {events.map((e) => (
                <li key={e.id} style={{ display: "flex", gap: "var(--s-3)", padding: "2px 0", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ color: "var(--oxblood)", minWidth: "9rem" }}>{e.type}</span>
                  <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
