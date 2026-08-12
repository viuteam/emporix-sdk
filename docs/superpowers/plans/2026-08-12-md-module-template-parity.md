# md-module Template Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `examples/md-module` in line with `emporix/md-module-template` on the four
divergences that are real compatibility risks, plus per-mode builds — without adopting the
template's UI stack.

**Architecture:** One committed TypeScript module becomes the single source for
`{ apiUrl, dashboardOrigin }` per Vite mode, read by both `vite.config.ts` (build time) and
`src/emporix.ts` (runtime). `appState` becomes optional with a default so a host that mounts
the remote without props gets an explanatory empty state rather than a crash. The federation
`shared` entry states the React range the module accepts instead of leaving it implicit.

**Tech Stack:** Vite 6, `@originjs/vite-plugin-federation` 1.4.1, React 19, Vitest,
`@viu/emporix-sdk` + `@viu/emporix-sdk-react` from the workspace.

## Global Constraints

- **Everything written into the repo is English** — comments, JSDoc, commit messages, PR
  body, README prose, test names (`CLAUDE.md`).
- **Commitlint:** scope must be one of `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth, http, logger,
  deps, docs, examples`. First word after the scope must be a **lowercase verb**. This plan's
  commits all use `examples` or `docs`.
- **`exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true`** repo-wide
  (`tsconfig.base.json:8-9`). An indexed lookup yields `T | undefined`, so guards after
  indexing are required, not redundant.
- **No changeset.** `@viu/emporix-examples-*` are listed under `ignore` in
  `.changeset/config.json` — never versioned, never published.
- **`.env*` files are off-limits to the agent.** Only `.env.example` may exist in the repo at
  all (`.gitignore:7-9` ignores `.env` and `.env.*` with a single `!.env.example` exception).
  The design deliberately needs **no** env file to work; `.env.example` is documentation and
  is created by the repo owner, not by this plan.
- **React stays at 19.** This is a deliberate decision by the requester, against the
  recommendation to match the template's 18.3. Task 2 records the consequence in code rather
  than dropping it.
- **Verification before any completion claim:** run the commands given and report the real
  output.
- **Never merge a PR.** Open it and hand it over.
- **Branch:** `feat/md-module-template-parity`, cut from a freshly pulled `main`.

## The four divergences this closes

Measured against the upstream template on 2026-08-12.

| # | Divergence | Why it matters |
|---|---|---|
| 1 | Our CORS allowlist hardcodes `https://admin.emporix.io` | The template's **dev** dashboard is `https://dev-admin.emporix.io`. A dev build cannot be loaded by the dev dashboard, and the failure is a silent cross-origin refusal on `remoteEntry.js` — no error in the module, because the module never runs. |
| 2 | `appState` is a required prop with no default | The template makes it optional with a fallback. A host that mounts the remote without props, or with a partial object, crashes ours — inside a federated remote, which is where a crash is hardest to trace. |
| 3 | `shared: ["react", "react-dom"]` states no version range | The **host** supplies React at runtime. The template pins 18.3; we build against 19. The range belongs in the config so the constraint is visible and so nothing in `src/` may use a 19-only API. |
| 4 | One build, one implicit environment | The template ships `build:dev` / `build:stage` / `build`, because API host **and** dashboard origin both differ per environment. |

## Why this plan does *not* port `scripts/ensure-cors-origin.mjs`

The template needs that script because the dashboard origin lives in **two** places — in
`.env*` and hardcoded in `vite.config.ts` — so the two can drift, and the script checks they
agree. It is also interactive (`readline/promises`), which makes it unusable in CI.

Deriving both the CORS allowlist and the runtime API host from one module removes the
possibility of drift instead of guarding it. What replaces the guard is a throw on an unknown
mode: a typo in `--mode` fails the build loudly rather than producing a build pointed at the
wrong dashboard.

## Deliberately still different from the template

- **No `@emporix/component-library`** — does not resolve from the public npm registry, so
  depending on it would make the example unbuildable without registry access.
- **No `react-router`, `react-i18next`, `chart.js`, `quill`** — every additional `shared`
  entry is another version negotiation with a host we do not control, and this example is
  about the SDK wiring.
- **No `frontend-ai-rules` / AI-rules sync** — the template's own tooling.
- **No `tsconfig.app.json` / `tsconfig.node.json` split** — Task 2 extends the single
  tsconfig to cover `vite.config.ts` instead, which is the only reason the template needs the
  split.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `examples/md-module/src/environments.ts` | **new** — the single source: mode → `{ apiUrl, dashboardOrigin }`, plus `resolveEnvironment` |
| `examples/md-module/tests/environments.test.ts` | **new** — the runnable check for the three branches in `resolveEnvironment` |
| `examples/md-module/vite.config.ts` | mode-aware; CORS and the federation React range from one place |
| `examples/md-module/src/emporix.ts` | takes the API host from the resolved environment |
| `examples/md-module/src/RemoteComponent.tsx` | `appState` optional with default; explains an unconfigured mount |
| `examples/md-module/tsconfig.json` | also typechecks `vite.config.ts` |
| `examples/md-module/package.json` | per-mode build scripts, `vitest`, `@types/node` |
| `examples/md-module/README.md` | the modes table and what the host must pass |
| `examples/README.md` | run-command row updated for the new scripts |

---

## Task 1: the environment module and its check

**Files:**
- Create: `examples/md-module/src/environments.ts`
- Create: `examples/md-module/tests/environments.test.ts`
- Modify: `examples/md-module/package.json` (add `vitest` devDep + `test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `interface Environment { apiUrl: string; dashboardOrigin: string }`;
  `type EnvironmentName = "dev" | "stage" | "prod"`;
  `resolveEnvironment(mode: string, env?: Record<string, string | undefined>): Environment`
  — throws on an unknown mode. Both `vite.config.ts` (Task 2) and `src/emporix.ts` (Task 2)
  call it.

- [ ] **Step 1: Add vitest and the test script**

In `examples/md-module/package.json`, add to `scripts` (after `typecheck`):

```json
    "test": "vitest run"
```

and to `devDependencies`:

```json
    "vitest": "^4.1.0"
```

This matches `examples/next-server-first`, which is the precedent for a tested example
(`"test": "vitest run"`, tests in a top-level `tests/` directory).

- [ ] **Step 2: Write the failing test**

Create `examples/md-module/tests/environments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveEnvironment } from "../src/environments";

describe("resolveEnvironment", () => {
  it("points dev at the dev dashboard, not the production one", () => {
    // The whole reason this module exists. The upstream template's .env uses
    // dev-admin.emporix.io; a build that only allows admin.emporix.io cannot be
    // loaded by the dev dashboard at all.
    expect(resolveEnvironment("dev")).toEqual({
      apiUrl: "https://api-develop.emporix.io",
      dashboardOrigin: "https://dev-admin.emporix.io",
    });
  });

  it("maps Vite's implicit modes onto ours", () => {
    // `vite` with no --mode is "development"; `vite build` is "production".
    // Without the aliases, `pnpm dev` would throw.
    expect(resolveEnvironment("development")).toEqual(resolveEnvironment("dev"));
    expect(resolveEnvironment("production")).toEqual(resolveEnvironment("prod"));
  });

  it("resolves stage and prod to their own hosts", () => {
    expect(resolveEnvironment("stage")).toEqual({
      apiUrl: "https://api-stage.emporix.io",
      dashboardOrigin: "https://admin.emporix.io",
    });
    expect(resolveEnvironment("prod")).toEqual({
      apiUrl: "https://api.emporix.io",
      dashboardOrigin: "https://admin.emporix.io",
    });
  });

  it("lets an env variable override either field", () => {
    // This is what makes the design work with no committed env file: the repo's
    // .gitignore keeps every `.env*` out except `.env.example`, so a developer
    // overrides through .env.local or the shell.
    const r = resolveEnvironment("prod", {
      VITE_API_URL: "https://api-develop.emporix.io",
      VITE_DASHBOARD_ORIGIN: "http://localhost:4173",
    });
    expect(r).toEqual({
      apiUrl: "https://api-develop.emporix.io",
      dashboardOrigin: "http://localhost:4173",
    });
  });

  it("overrides one field without disturbing the other", () => {
    expect(resolveEnvironment("stage", { VITE_API_URL: "https://example.test" })).toEqual({
      apiUrl: "https://example.test",
      dashboardOrigin: "https://admin.emporix.io",
    });
  });

  it("throws on an unknown mode instead of guessing", () => {
    // A typo in --mode must fail the build. Falling back to a default would
    // ship a bundle pointed at the wrong dashboard, and the only symptom is a
    // module that never loads.
    expect(() => resolveEnvironment("staging")).toThrow(/Unknown mode "staging"/);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

```bash
pnpm install
pnpm -F @viu/emporix-examples-md-module test
```

Expected: FAIL — cannot resolve `../src/environments`.

- [ ] **Step 4: Write the module**

Create `examples/md-module/src/environments.ts`:

```ts
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
```

- [ ] **Step 5: Run the test and confirm it passes**

```bash
pnpm -F @viu/emporix-examples-md-module test
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add examples/md-module/src/environments.ts examples/md-module/tests/environments.test.ts \
  examples/md-module/package.json pnpm-lock.yaml
git commit -m "feat(examples): add the md-module environment map

The dashboard origin differs per environment and the dev one is dev-admin, not
admin — a build allowing only admin.emporix.io cannot be loaded by the dev
dashboard, and the failure is a silent cross-origin refusal on remoteEntry.js.

One committed module rather than per-mode .env files: this repo's .gitignore
allows only .env.example, and these are hostnames, not secrets. An env variable
still overrides either field."
```

---

## Task 2: mode-aware config, one source, declared React range

**Files:**
- Modify: `examples/md-module/vite.config.ts` (whole file)
- Modify: `examples/md-module/src/emporix.ts:19` (the `host` value)
- Modify: `examples/md-module/tsconfig.json`
- Modify: `examples/md-module/package.json` (add `@types/node`)

**Interfaces:**
- Consumes: `resolveEnvironment(mode, env)` and `Environment` from Task 1.
- Produces: a `vite.config.ts` default export of the function form
  `defineConfig(({ mode }) => ({ … }))`; no new exported symbols.

- [ ] **Step 1: Rewrite the Vite config**

Replace `examples/md-module/vite.config.ts` entirely:

```ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";
import { resolveEnvironment } from "./src/environments";

export default defineConfig(({ mode }) => {
  // Same resolver the runtime uses (src/emporix.ts), so the CORS allowlist and
  // the API host cannot disagree. The upstream template keeps the origin in
  // .env AND hardcoded here, then ships scripts/ensure-cors-origin.mjs to check
  // the two agree; one source removes the drift instead of guarding it.
  //
  // An unknown --mode throws here, which fails the build. That is deliberate:
  // the alternative is a bundle pointed at the wrong dashboard whose only
  // symptom is a module that never loads.
  const { dashboardOrigin } = resolveEnvironment(mode, loadEnv(mode, process.cwd(), "VITE_"));
  const cors = { origin: [dashboardOrigin], credentials: true };

  return {
    plugins: [
      react(),
      federation({
        name: "extension",
        filename: "remoteEntry.js",
        exposes: { "./RemoteComponent": "./src/RemoteComponent" },
        shared: {
          // The HOST supplies React at runtime — that is what `shared` means,
          // and it is not optional: the host renders our component inside its
          // own tree, so our hooks run through the host's reconciler. Two React
          // copies break every hook.
          //
          // This example is built against 19 while the upstream template pins
          // 18.3, so the dashboard may well hand us 18. The range states that
          // both are acceptable, which matches @viu/emporix-sdk-react's own
          // peer range. The consequence is a rule: nothing under src/ may use a
          // React-19-only API.
          react: { requiredVersion: "^18.0.0 || ^19.0.0" },
          "react-dom": { requiredVersion: "^18.0.0 || ^19.0.0" },
        },
      }),
    ],
    build: { modulePreload: false, target: "esnext", cssCodeSplit: false },
    server: { cors },
    preview: { cors },
  };
});
```

- [ ] **Step 2: Take the API host from the resolver**

In `examples/md-module/src/emporix.ts`, add the import below the existing one:

```ts
import { resolveEnvironment } from "./environments";
```

Immediately below the `clients` map declaration, add:

```ts
// Resolved once per module load. `import.meta.env.MODE` is the mode the bundle
// was built with, so a build:stage bundle talks to the stage API without any
// runtime configuration.
const { apiUrl } = resolveEnvironment(import.meta.env.MODE, import.meta.env);
```

and change the client construction's `host` from `import.meta.env.VITE_API_URL` to `apiUrl`:

```ts
    c = new EmporixClient({
      tenant,
      host: apiUrl,
      credentials: {},
    });
```

Update that function's JSDoc line about `host` to read:

```
 * `credentials: {}` is legal and intended — the host owns the token, so no
 * client-credentials or storefront client id exist. `host` comes from
 * `environments.ts`, keyed on the build mode, because the dashboard's dev,
 * stage and prod environments each have their own API host.
```

- [ ] **Step 3: Typecheck the Vite config too**

`vite.config.ts` now contains real logic, and the current tsconfig only includes `src`, so
`tsc --noEmit` never looks at it. In `examples/md-module/tsconfig.json`, change the last two
fields:

```json
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts"]
```

`types: ["node"]` is needed for `process.cwd()` in the config. Add the matching devDep in
`examples/md-module/package.json`:

```json
    "@types/node": "^24.0.0"
```

- [ ] **Step 4: Verify the whole matrix builds and points where it should**

```bash
pnpm install
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-md-module typecheck
pnpm -F @viu/emporix-examples-md-module test
pnpm -F @viu/emporix-examples-md-module build
```

Expected: all pass, and the build emits `examples/md-module/dist/assets/remoteEntry.js`.
The two SDK builds first are not optional — examples typecheck against `dist/`, not source.

Then confirm the mode actually reaches the bundle, rather than trusting it:

```bash
grep -c "api\.emporix\.io" examples/md-module/dist/assets/*.js
```

Expected: at least one hit (the `build` script uses `--mode prod`). Repeat with
`pnpm -F @viu/emporix-examples-md-module exec vite build --mode dev` and grep for
`api-develop\.emporix\.io` — that is the proof that per-mode resolution works end to end,
and it is the one thing a passing unit test does not establish.

- [ ] **Step 5: Commit**

```bash
git add examples/md-module/vite.config.ts examples/md-module/src/emporix.ts \
  examples/md-module/tsconfig.json examples/md-module/package.json pnpm-lock.yaml
git commit -m "feat(examples): resolve the md-module host and CORS origin per mode

vite.config.ts and src/emporix.ts now read the same environments module, so the
CORS allowlist and the API host cannot drift. An unknown --mode throws and
fails the build rather than shipping a bundle aimed at the wrong dashboard.

The federation shared entry states the React range the module accepts. The host
supplies React at runtime; this example is built against 19 while the template
pins 18.3, so both must be acceptable and nothing under src/ may use a
19-only API.

tsconfig now covers vite.config.ts, which had never been typechecked."
```

---

## Task 3: an unconfigured mount explains itself

**Files:**
- Modify: `examples/md-module/src/RemoteComponent.tsx`

**Interfaces:**
- Consumes: `clientFor(tenant)` from `src/emporix.ts` (unchanged signature).
- Produces: `RemoteComponent({ appState }: { appState?: AppState })` — the prop is now
  **optional**. `AppState` stays exported from this file unchanged.

- [ ] **Step 1: Make the prop optional with a default**

In `examples/md-module/src/RemoteComponent.tsx`, add above the component:

```tsx
/**
 * Fallback for a host that mounts the remote without props. The upstream
 * template does the same (`appState = { tenant: 'default', … }`), and for a
 * good reason: a crash inside a federated remote surfaces as a blank panel with
 * a stack trace pointing at bundled code, which is far harder to diagnose than
 * a sentence saying what is missing.
 *
 * `token: ""` rather than the template's `"default"` so the unconfigured case
 * is detectable — a literal "default" token would be sent to Emporix and come
 * back 401, which looks like an expired session rather than a wiring mistake.
 */
const UNCONFIGURED: AppState = { tenant: "default", language: "en", token: "" };
```

Change the signature:

```tsx
export default function RemoteComponent({
  appState = UNCONFIGURED,
}: {
  appState?: AppState;
}): React.JSX.Element {
```

- [ ] **Step 2: Explain it before touching the client**

Immediately after the two `useState` calls and **before** the `sessionDead` branch, insert:

```tsx
  // Before clientFor(): the SDK validates the tenant against
  // /^[a-z][a-z0-9]{2,15}$/ and would throw on a malformed one, which would be
  // a crash where a message belongs.
  if (appState.token === "") {
    return (
      <section>
        <h1>Not configured</h1>
        <p>
          This module received no dashboard session. The Managed Dashboard is expected to
          render it as{" "}
          <code>{"<RemoteComponent appState={{ tenant, language, token }} />"}</code> — the
          token is empty, so either no props were passed or the host is not wired up.
        </p>
      </section>
    );
  }
```

- [ ] **Step 3: Verify both paths**

```bash
pnpm -F @viu/emporix-examples-md-module typecheck
pnpm -F @viu/emporix-examples-md-module build
```

Expected: both pass.

Then check the unconfigured path renders rather than crashing. `src/main.tsx` reads
`VITE_DEMO_TOKEN`, which is empty unless a `.env.local` supplies it — so with no
`.env.local` present, `pnpm dev` should show the "Not configured" panel and **no** console
exception:

```bash
pnpm -F @viu/emporix-examples-md-module dev
```

Open the printed URL, confirm the panel, confirm a clean console. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add examples/md-module/src/RemoteComponent.tsx
git commit -m "feat(examples): let an unconfigured md-module mount explain itself

appState is optional with a fallback, as in the upstream template: a host that
mounts the remote without props got a crash, and a crash inside a federated
remote is a blank panel with a stack trace into bundled code.

The empty-token check runs before clientFor(), because the SDK validates the
tenant and would throw where a message belongs."
```

---

## Task 4: per-mode scripts and the docs

**Files:**
- Modify: `examples/md-module/package.json` (`scripts`)
- Modify: `examples/md-module/README.md`
- Modify: `examples/README.md` (the run-command table row for `md-module`)

**Interfaces:**
- Consumes: the modes from Task 1, the config from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the per-mode scripts**

Replace the `scripts` block in `examples/md-module/package.json` with:

```json
  "scripts": {
    "dev": "vite",
    "dev:stage": "vite --mode stage",
    "build:dev": "tsc -b && vite build --mode dev",
    "build:stage": "tsc -b && vite build --mode stage",
    "build": "tsc -b && vite build --mode prod",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
```

`build` maps to `--mode prod`, matching the template, where the unsuffixed `build` is the
production one.

- [ ] **Step 2: Document the modes in the example README**

In `examples/md-module/README.md`, replace the "## Running it" section with:

````markdown
## Environments

The dashboard runs in three environments and each has its own API host **and** its own
dashboard origin. `src/environments.ts` holds all three; `vite.config.ts` uses the origin for
the CORS allowlist and `src/emporix.ts` uses the API host at runtime, both from that one
module.

| Command | Mode | API host | Dashboard origin allowed |
| --- | --- | --- | --- |
| `pnpm dev` | `development` → dev | `api-develop.emporix.io` | `dev-admin.emporix.io` |
| `pnpm dev:stage` | `stage` | `api-stage.emporix.io` | `admin.emporix.io` |
| `pnpm build:dev` | `dev` | `api-develop.emporix.io` | `dev-admin.emporix.io` |
| `pnpm build:stage` | `stage` | `api-stage.emporix.io` | `admin.emporix.io` |
| `pnpm build` | `prod` | `api.emporix.io` | `admin.emporix.io` |

The dev dashboard is **`dev-admin`**, not `admin`. Getting that wrong does not produce an
error you can see: the browser refuses the cross-origin fetch of `remoteEntry.js`, so the
module never runs and cannot report anything.

An unknown `--mode` throws at config load and fails the build, rather than quietly falling
back to a default and shipping a bundle aimed at the wrong dashboard.

## Running it

No env file is required — the environments above are committed. To point the module somewhere
else, or to give the standalone dev harness a real session, create an untracked `.env.local`
in this directory:

```
# Optional overrides of src/environments.ts
VITE_API_URL=https://api-develop.emporix.io
VITE_DASHBOARD_ORIGIN=https://dev-admin.emporix.io

# What the dashboard would pass as appState — used only by src/main.tsx
VITE_DEMO_TENANT=<your tenant>
VITE_DEMO_LANGUAGE=de
VITE_DEMO_TOKEN=<a customer token from a dashboard session>
```

Without `VITE_DEMO_TOKEN` the module renders a "Not configured" panel instead of crashing —
the same fallback a host gets if it mounts the remote without props.

The token is the one the dashboard would hand the module. Take it from a live dashboard
session. **It is a credential — keep it in `.env.local`, which is gitignored, and never
commit it.**

```bash
pnpm -F @viu/emporix-examples-md-module dev
```
````

- [ ] **Step 3: Extend the divergence list in the example README**

In the "What this example does differently from the upstream template" section, append two
bullets:

```markdown
- **React 19 instead of the template's 18.3.** The host supplies React at runtime through
  federation's `shared`, so the module executes on whatever the dashboard provides. The
  `shared` entry declares `^18.0.0 || ^19.0.0` to state that both are acceptable — which
  means nothing under `src/` may use a React-19-only API.
- **No `scripts/ensure-cors-origin.mjs`.** The template needs it because the dashboard origin
  lives both in `.env*` and hardcoded in `vite.config.ts`, so the two can drift. Here both the
  allowlist and the API host come from `src/environments.ts`, so there is nothing to guard —
  and the template's script is interactive, which makes it unusable in CI.
```

- [ ] **Step 4: Update the run-command row**

In `examples/README.md`, replace the `md-module` row of the run-command table with:

```markdown
| `md-module` | `pnpm -F @viu/emporix-examples-md-module dev` | none — hosts are committed per mode in `src/environments.ts`; `.env.local` optionally supplies `VITE_DEMO_TENANT` / `VITE_DEMO_LANGUAGE` / `VITE_DEMO_TOKEN`, see its [README](./md-module/README.md) |
```

- [ ] **Step 5: Verify the documented commands actually exist and work**

```bash
pnpm -F @viu/emporix-examples-md-module build:dev
pnpm -F @viu/emporix-examples-md-module build:stage
pnpm -F @viu/emporix-examples-md-module build
```

Expected: three successful builds. Do not claim the table is correct without having run all
three — the whole point of the table is that each row differs.

- [ ] **Step 6: Commit**

```bash
git add examples/md-module/package.json examples/md-module/README.md examples/README.md
git commit -m "docs(examples): document the md-module build modes"
```

---

## Task 5: `.env.example`, full verification, PR

**Files:**
- Modify: nothing by the agent.
- Hand off: `examples/md-module/.env.example` — the repo owner creates it.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: nothing.

- [ ] **Step 1: Hand off `.env.example`**

`.env*` paths are outside the agent's write permission, and `.gitignore:9` lets exactly one
through. Ask the repo owner to create `examples/md-module/.env.example` with:

```
# All values are OPTIONAL. src/environments.ts holds the committed defaults for
# dev / stage / prod; anything set here (or in .env.local) overrides them.

# Override the environment resolved from the build mode.
VITE_API_URL=
VITE_DASHBOARD_ORIGIN=

# What the Managed Dashboard would pass as appState. Used only by src/main.tsx,
# which stands in for the host during local development.
# VITE_DEMO_TOKEN is a credential — put the real value in .env.local, never here.
VITE_DEMO_TENANT=
VITE_DEMO_LANGUAGE=de
VITE_DEMO_TOKEN=
```

This is documentation only. Every command in Task 4 works without it — do not block the PR
on it, and say in the PR body that it is outstanding.

- [ ] **Step 2: Run the full verification**

```bash
pnpm -r test
pnpm typecheck
pnpm -r --filter "./packages/*" lint
```

Expected: all pass. Report the real counts.

- [ ] **Step 3: Push and open the PR**

```bash
git push origin feat/md-module-template-parity
gh pr create --base main \
  --title "feat(examples): align md-module with the dashboard module template" \
  --body-file /tmp/pr-md-module-parity-body.md
```

Push over SSH — the `gho_` token works for `gh` API calls but is rejected for git itself.

The PR body must state: the four divergences with why each is a risk (especially that the dev
dashboard is `dev-admin` and that the failure is silent), that React stays at 19 **as a
deliberate decision against the recommendation to match the template's 18.3** together with
the `requiredVersion` mitigation and the resulting no-19-only-APIs rule, why
`ensure-cors-origin.mjs` was not ported, the per-mode build evidence from Task 2 Step 4
(grepping the bundles for the host), and that `.env.example` is outstanding.

No changeset: `@viu/emporix-examples-*` are under `ignore` in `.changeset/config.json`. If the
`changeset` CI job fails anyway on an examples-only PR, the workflow skips itself when the PR
carries the **`no-release`** label (`.github/workflows/changeset-check.yml:12`) — use that
rather than inventing a changeset for an unpublished package.

Do **not** merge.

---

## Risks this plan knowingly accepts

- **React 19 against a possibly-18 host.** Mitigated by the declared `requiredVersion` range
  and the no-19-only-APIs rule, not eliminated. `@originjs/vite-plugin-federation@1.4.1` does
  not support `singleton` (it is commented out in its own types at
  `types/index.d.ts:299`), so there is no way to force a single instance; and whether
  `requiredVersion` is enforced at runtime by this plugin version has **not** been verified
  end to end, because that needs a real host to load the remote.
- **Nothing is measured against a real Managed Dashboard.** Every check in this plan is local:
  unit tests, typecheck, builds, and a grep of the emitted bundle. Loading the remote from
  `dev-admin.emporix.io` would need dashboard access this plan does not have.
