import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

// The dashboard origin that must be allowed to load remoteEntry.js.
const corsOrigins = ["https://admin.emporix.io"];

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "extension",
      filename: "remoteEntry.js",
      exposes: { "./RemoteComponent": "./src/RemoteComponent" },
      // react/react-dom only. The SDK packages and react-query are bundled into
      // the remote on purpose: the host does not know our versions, and the
      // module owns its own QueryClient and cache lifetime.
      shared: ["react", "react-dom"],
    }),
  ],
  build: { modulePreload: false, target: "esnext", cssCodeSplit: false },
  server: { cors: { origin: corsOrigins, credentials: true } },
  preview: { cors: { origin: corsOrigins, credentials: true } },
});
