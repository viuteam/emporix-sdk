import type { EmporixTelemetryEvent } from "@viu/emporix-sdk-react";

export interface HudEvent {
  id: number;
  type: string;
  detail: string;
}

let events: HudEvent[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function keyText(k: readonly unknown[]): string {
  return k.filter((x) => typeof x === "string").join("/");
}

function detailOf(e: EmporixTelemetryEvent): string {
  switch (e.type) {
    case "cache.hit":
      return keyText(e.queryKey);
    case "cache.miss":
      return `${keyText(e.queryKey)} · ${e.durationMs}ms`;
    case "query.refetch":
      return `${keyText(e.queryKey)} · ${e.reason}`;
    case "query.error":
      return keyText(e.queryKey);
    case "mutation.success":
      return `${e.durationMs}ms`;
    case "mutation.error":
      return `${e.durationMs}ms`;
    case "auth.refresh":
      return `${e.kind} · ${e.success ? "ok" : "failed"}`;
    case "storage.write":
      return e.key;
    case "company:switched":
      return `${e.from ?? "—"} → ${e.to ?? "—"}`;
    case "custom":
      return e.name;
    default:
      return "";
  }
}

export function pushTelemetry(e: EmporixTelemetryEvent): void {
  events = [{ id: ++seq, type: e.type, detail: detailOf(e) }, ...events].slice(0, 50);
  for (const l of listeners) l();
}

export function subscribeTelemetry(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getTelemetry(): HudEvent[] {
  return events;
}
