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
