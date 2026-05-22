import { useState, useEffect } from "react";
import type { EmporixTelemetryEvent } from "@viu/emporix-sdk-react";

interface Counts {
  cacheHit: number;
  cacheMiss: number;
  queryRefetch: number;
  queryError: number;
  mutationSuccess: number;
  mutationError: number;
  authRefresh: number;
  storageWrite: number;
  custom: number;
}

const initial: Counts = {
  cacheHit: 0,
  cacheMiss: 0,
  queryRefetch: 0,
  queryError: 0,
  mutationSuccess: 0,
  mutationError: 0,
  authRefresh: 0,
  storageWrite: 0,
  custom: 0,
};

/**
 * Live telemetry counter displayed as a fixed-position overlay. Consumer apps
 * would replace this with their analytics-platform wire-up (Datadog/Sentry).
 *
 * Bridge: `pushEvent` is set by the EmporixProvider's onTelemetry prop in
 * main.tsx; this hook subscribes to those pushes.
 */
export function useTelemetryBridge(): {
  pushEvent: (event: EmporixTelemetryEvent) => void;
  counts: Counts;
} {
  const [counts, setCounts] = useState<Counts>(initial);
  const pushEvent = (event: EmporixTelemetryEvent): void => {
    setCounts((prev) => {
      const next = { ...prev };
      switch (event.type) {
        case "cache.hit":
          next.cacheHit += 1;
          break;
        case "cache.miss":
          next.cacheMiss += 1;
          break;
        case "query.refetch":
          next.queryRefetch += 1;
          break;
        case "query.error":
          next.queryError += 1;
          break;
        case "mutation.success":
          next.mutationSuccess += 1;
          break;
        case "mutation.error":
          next.mutationError += 1;
          break;
        case "auth.refresh":
          next.authRefresh += 1;
          break;
        case "storage.write":
          next.storageWrite += 1;
          break;
        case "custom":
          next.custom += 1;
          break;
      }
      return next;
    });
  };
  return { pushEvent, counts };
}

/** Visual overlay showing live counts. Toggle with `?` key. */
export function TelemetryHUD({ counts }: { counts: Counts }): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "?") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!visible) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: 8,
          right: 8,
          padding: "4px 8px",
          fontSize: 11,
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.6)",
          color: "white",
          borderRadius: 4,
          cursor: "pointer",
        }}
        onClick={() => setVisible(true)}
        title="Press '?' to toggle telemetry HUD"
      >
        telemetry ▾
      </div>
    );
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows: Array<[string, number, string]> = [
    ["cache.hit", counts.cacheHit, "#4ade80"],
    ["cache.miss", counts.cacheMiss, "#fbbf24"],
    ["query.refetch", counts.queryRefetch, "#60a5fa"],
    ["query.error", counts.queryError, "#f87171"],
    ["mutation.success", counts.mutationSuccess, "#4ade80"],
    ["mutation.error", counts.mutationError, "#f87171"],
    ["auth.refresh", counts.authRefresh, "#a78bfa"],
    ["storage.write", counts.storageWrite, "#e879f9"],
    ["custom", counts.custom, "#94a3b8"],
  ];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        padding: 12,
        fontSize: 12,
        fontFamily: "monospace",
        background: "rgba(0,0,0,0.85)",
        color: "white",
        borderRadius: 6,
        minWidth: 240,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8,
          fontWeight: "bold",
        }}
      >
        <span>emporix telemetry</span>
        <button
          style={{
            background: "none",
            border: "none",
            color: "white",
            cursor: "pointer",
            padding: 0,
            fontSize: 14,
          }}
          onClick={() => setVisible(false)}
          aria-label="close"
        >
          ×
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(([label, count, color]) => (
            <tr key={label}>
              <td style={{ color, paddingRight: 12 }}>{label}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {count}
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ paddingTop: 6, borderTop: "1px solid #444" }}>total</td>
            <td
              style={{
                paddingTop: 6,
                borderTop: "1px solid #444",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {total}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 10, color: "#94a3b8" }}>
        Press <kbd>?</kbd> to toggle
      </div>
    </div>
  );
}
