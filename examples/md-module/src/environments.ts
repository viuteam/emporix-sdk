/** One Emporix environment the Managed Dashboard runs in. */
export interface Environment {
  /** Emporix API base URL. Bound as `host` on the SDK client. */
  apiUrl: string;
  /** Dashboard origin that must be allowed to fetch `remoteEntry.js`. */
  dashboardOrigin: string;
}

/**
 * Values taken from the upstream template's `.env` / `.env.stage` / `.env.prod`
 * (emporix/md-module-template, read 2026-08-12).
 *
 * Note that the **dev** dashboard is `dev-admin`, not `admin`. A build whose
 * CORS allowlist only contains `admin.emporix.io` cannot be loaded by the dev
 * dashboard, and the failure mode is a silent cross-origin refusal on
 * `remoteEntry.js` — the module never runs, so it cannot report anything.
 *
 * Committed rather than kept in `.env` files on purpose: this repo's
 * `.gitignore` ignores `.env` and `.env.*` with a single `!.env.example`
 * exception, so per-mode env files could not be committed without punching a
 * hole in a rule that exists to keep credentials out. These are hostnames, not
 * secrets, and having them here means `build:dev` / `build:stage` / `build`
 * work for anyone straight after a clone.
 */
const ENVIRONMENTS = {
  dev: {
    apiUrl: "https://api-develop.emporix.io",
    dashboardOrigin: "https://dev-admin.emporix.io",
  },
  stage: {
    apiUrl: "https://api-stage.emporix.io",
    dashboardOrigin: "https://admin.emporix.io",
  },
  prod: {
    apiUrl: "https://api.emporix.io",
    dashboardOrigin: "https://admin.emporix.io",
  },
} as const satisfies Record<string, Environment>;

export type EnvironmentName = keyof typeof ENVIRONMENTS;

/**
 * Vite's implicit modes are `development` (`vite`) and `production`
 * (`vite build`) — not our names. Mapping them keeps `pnpm dev` working
 * without an explicit `--mode`.
 */
const MODE_ALIASES: Record<string, EnvironmentName> = {
  development: "dev",
  production: "prod",
};

/**
 * Resolves the environment for a Vite mode.
 *
 * An explicit `VITE_API_URL` or `VITE_DASHBOARD_ORIGIN` — from `.env.local`, or
 * from the shell — wins over the built-in value. That is what lets this work
 * with no committed env file while still allowing a developer to point the
 * module somewhere else.
 *
 * Called from two places, which is the point: `vite.config.ts` for the CORS
 * allowlist at build time, and `src/emporix.ts` for the API host at runtime.
 * One source, so the two cannot drift — the template keeps them in two places
 * and ships a script to check they agree.
 */
export function resolveEnvironment(
  mode: string,
  env: Record<string, string | undefined> = {},
): Environment {
  const name = MODE_ALIASES[mode] ?? mode;
  // `noUncheckedIndexedAccess` makes this `Environment | undefined`, so the
  // guard below is required by the types as well as by reality.
  const base = ENVIRONMENTS[name as EnvironmentName];
  if (base === undefined) {
    throw new Error(
      `Unknown mode "${mode}". Expected one of ${Object.keys(ENVIRONMENTS).join(", ")}, ` +
        `or Vite's implicit ${Object.keys(MODE_ALIASES).join(" / ")}.`,
    );
  }
  return {
    apiUrl: env.VITE_API_URL ?? base.apiUrl,
    dashboardOrigin: env.VITE_DASHBOARD_ORIGIN ?? base.dashboardOrigin,
  };
}
