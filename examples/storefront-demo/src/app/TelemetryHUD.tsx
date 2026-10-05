import { useSyncExternalStore, useState } from "react";
import { subscribeTelemetry, getTelemetry } from "./telemetry-store";

export function TelemetryHUD() {
  const events = useSyncExternalStore(subscribeTelemetry, getTelemetry, getTelemetry);
  const [open, setOpen] = useState(false);

  return (
    <div className="telemetry">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn--outline btn--sm telemetry__toggle"
        aria-expanded={open}
      >
        ◴ telemetry {events.length ? `(${events.length})` : ""}
      </button>
      {open ? (
        <div className="surface telemetry__panel">
          {events.length === 0 ? (
            <p className="muted">No events yet — interact with the store.</p>
          ) : (
            <ul className="telemetry__list">
              {events.map((e) => (
                <li key={e.id} className="telemetry__row">
                  <span className="telemetry__type">{e.type}</span>
                  <span className="telemetry__detail">{e.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
