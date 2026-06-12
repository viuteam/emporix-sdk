import type { EmporixConfig } from "./core/config";
import type { ServiceName } from "./core/logger";
import { EmporixError } from "./core/errors";
import { createCore, type EmporixCore } from "./core/create-core";

/**
 * A service class the factory can instantiate: carries its channel + optional
 * deps. The constructor signature is intentionally loose (`...args: any[]`) so
 * both dep-free services (`new Svc(ctx)`) and dependent ones
 * (`new Svc(ctx, deps)` — e.g. `SegmentService`) satisfy it.
 */
export interface ServiceClass<I> {
  readonly channel: ServiceName;
  readonly deps?: readonly string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): I;
}

/**
 * Tree-shakeable client factory. Builds ONLY the service classes you pass —
 * imports no services itself, so a bundler drops every service you don't use.
 * `EmporixClient` remains the batteries-included default; reach for this when
 * bundle size matters. Dependent services (e.g. `segments`) require their deps
 * to be present in the map under their public names (`products`, `categories`).
 */
export function createEmporixClient<S extends Record<string, ServiceClass<unknown>>>(
  config: EmporixConfig,
  services: S,
): Omit<EmporixCore, "mk"> & { [K in keyof S]: InstanceType<S[K]> } {
  const { mk, ...core } = createCore(config);
  const built: Record<string, unknown> = {};
  const entries = Object.entries(services) as [string, ServiceClass<unknown>][];

  // Pass 1: dependency-free services.
  for (const [key, Svc] of entries) {
    if (!Svc.deps?.length) built[key] = new Svc(mk(Svc.channel));
  }
  // Pass 2: dependents (only `segments` today; deps are all dep-free, so two
  // passes suffice — a deeper graph would need a topological sort).
  for (const [key, Svc] of entries) {
    if (!Svc.deps?.length) continue;
    const deps: Record<string, unknown> = {};
    for (const dep of Svc.deps) {
      if (!(dep in built)) {
        throw new EmporixError(
          `createEmporixClient: "${key}" requires "${dep}" in the services map`,
        );
      }
      deps[dep] = built[dep];
    }
    built[key] = new Svc(mk(Svc.channel), deps);
  }

  return { ...core, ...built } as Omit<EmporixCore, "mk"> & {
    [K in keyof S]: InstanceType<S[K]>;
  };
}
