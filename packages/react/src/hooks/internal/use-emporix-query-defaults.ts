import { useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Balanced React-Query defaults scoped to the `["emporix"]` key namespace of
 * whatever QueryClient is active (the fallback OR a consumer-supplied one).
 * Keeps the Emporix API-quota in check by suppressing window-focus refetches
 * and capping retries. Consumer-set emporix defaults and per-hook options win.
 */
const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;

/**
 * Scope our balanced defaults to the ["emporix"] key namespace on WHATEVER
 * QueryClient is in use — a bare consumer client (e.g. the next-app-router
 * example) otherwise runs SDK queries with React-Query factory defaults
 * (staleTime 0, focus refetch, retry 3 → multiplied by the SDK's own HTTP
 * retry). We only FILL GAPS: a consumer's explicit choices win, whether set
 * globally (`defaultOptions.queries`) or emporix-scoped — both are spread
 * after ours. Host-app queries outside the namespace are untouched.
 *
 * Runs during render (ref-guarded) so the defaults are in place before the
 * children's first fetch effects. Re-applies only for a new client.
 */
export function useEmporixQueryDefaults(qc: QueryClient): void {
  const defaultsRef = useRef<QueryClient | null>(null);
  if (defaultsRef.current !== qc) {
    qc.setQueryDefaults(["emporix"], {
      ...DEFAULT_QUERY_OPTIONS,
      ...qc.getDefaultOptions().queries,
      ...qc.getQueryDefaults(["emporix"]),
    });
    defaultsRef.current = qc;
  }
}
