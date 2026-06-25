import { useCallback, useEffect, useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../../storage/index";
import type { EmporixTelemetryEvent } from "../../telemetry";

interface TelemetrySourceArgs {
  qc: QueryClient;
  client: EmporixClient;
  storage: EmporixStorage;
  onTelemetry?: (event: EmporixTelemetryEvent) => void;
}

/**
 * Wires the telemetry source: a stable `safeEmit`, the memoized context value
 * (`{ emit }`), and the cache/mutation/auth/storage subscriptions. Everything
 * is a no-op when no `onTelemetry` callback was provided (no overhead). The
 * handler is try/catch-wrapped — a throwing handler never breaks the provider.
 *
 * Returns the memoized telemetry context value; `.emit` is also the stable
 * emitter other provider hooks (e.g. customer-token refresh) reuse.
 */
export function useTelemetrySource({
  qc,
  client,
  storage,
  onTelemetry,
}: TelemetrySourceArgs): { emit: (event: EmporixTelemetryEvent) => void } {
  // Telemetry: stable safeEmit + context value. emit is no-op when no
  // onTelemetry callback was provided (no overhead).
  const safeEmit = useCallback(
    (event: EmporixTelemetryEvent) => {
      if (!onTelemetry) return;
      try {
        onTelemetry(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[emporix] telemetry handler threw:", err);
      }
    },
    [onTelemetry],
  );
  const telemetryValue = useMemo(() => ({ emit: safeEmit }), [safeEmit]);

  // Source subscriptions: cache + mutation cache + token-provider + storage.
  // All only active when onTelemetry is provided.
  useEffect(() => {
    if (!onTelemetry) return;
    const startedAt = new Map<string, number>();

    const unsubQuery = qc.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key[0] !== "emporix") return;
      if (event.type === "updated") {
        const action = event.action as { type: string };
        if (action.type === "fetch") {
          const isRefetch = event.query.state.dataUpdateCount > 0;
          if (isRefetch) {
            safeEmit({
              type: "query.refetch",
              queryKey: key,
              tenant: client.tenant,
              reason: "invalidate",
            });
          }
          startedAt.set(event.query.queryHash, Date.now());
        } else if (action.type === "success") {
          const start = startedAt.get(event.query.queryHash);
          startedAt.delete(event.query.queryHash);
          safeEmit({
            type: "cache.miss",
            queryKey: key,
            tenant: client.tenant,
            durationMs: start ? Date.now() - start : 0,
          });
        } else if (action.type === "error") {
          startedAt.delete(event.query.queryHash);
          safeEmit({
            type: "query.error",
            queryKey: key,
            tenant: client.tenant,
            error: event.query.state.error,
          });
        }
      } else if (event.type === "observerResultsUpdated") {
        const s = event.query.state;
        if (s.status === "success" && s.fetchStatus === "idle" && s.dataUpdateCount > 0) {
          safeEmit({ type: "cache.hit", queryKey: key, tenant: client.tenant });
        }
      }
    });

    const unsubMut = qc.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const m = event.mutation;
      const dur = Date.now() - (m.state.submittedAt ?? Date.now());
      const mk = m.options.mutationKey;
      if (m.state.status === "success") {
        safeEmit({
          type: "mutation.success",
          ...(mk ? { mutationKey: mk as readonly unknown[] } : {}),
          tenant: client.tenant,
          durationMs: dur,
        });
      } else if (m.state.status === "error") {
        safeEmit({
          type: "mutation.error",
          ...(mk ? { mutationKey: mk as readonly unknown[] } : {}),
          tenant: client.tenant,
          error: m.state.error,
          durationMs: dur,
        });
      }
    });

    const unsubAuth = client.tokenProvider.onRefresh?.((evt) =>
      safeEmit({ type: "auth.refresh", ...evt, tenant: client.tenant }),
    );

    const unsubStorage = storage.subscribeAll?.((key) =>
      safeEmit({ type: "storage.write", key }),
    );

    return () => {
      unsubQuery();
      unsubMut();
      unsubAuth?.();
      unsubStorage?.();
    };
  }, [qc, onTelemetry, client, storage, safeEmit]);

  return telemetryValue;
}
