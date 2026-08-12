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

  it("maps Vite's own mode names onto ours", () => {
    // `vite` with no --mode is "development"; `vite build` is "production".
    // Without the aliases, `pnpm dev` would throw.
    expect(resolveEnvironment("development")).toEqual(resolveEnvironment("dev"));
    expect(resolveEnvironment("production")).toEqual(resolveEnvironment("prod"));
  });

  it("accepts Vitest's 'test' mode", () => {
    // Vitest loads vite.config.ts with mode "test", and that config calls this
    // resolver. Without the alias the whole suite dies at startup with
    // "Unknown mode" before a single test runs — which is exactly how this case
    // was found.
    expect(resolveEnvironment("test")).toEqual(resolveEnvironment("dev"));
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
