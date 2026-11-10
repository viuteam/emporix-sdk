import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { bffDevProxy } from "./bff-dev-proxy";

export default defineConfig(({ mode }) => {
  if (mode !== "bff") return { plugins: [react()] };
  // `vite --mode bff`: the SPA runs in proxy mode against a dev BFF. The client
  // id is read here, on the server, under a name without the VITE_ prefix, so it
  // never reaches the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      bffDevProxy({
        tenant: env.VITE_EMPORIX_TENANT ?? "mytenant",
        clientId: env.EMPORIX_STOREFRONT_CLIENT_ID ?? "",
        context: { siteCode: "main", currency: "CHF", targetLocation: "CH" },
      }),
    ],
  };
});
