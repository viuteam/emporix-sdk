import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createLocalStorageStorage } from "@viu/emporix-sdk-react";
import { App } from "./App";
import { TelemetryHUD, useTelemetryBridge } from "./TelemetryHUD";

const client = new EmporixClient({
  tenant: import.meta.env.VITE_EMPORIX_TENANT ?? "mytenant",
  // Storefront-only: never put a backend secret in browser code.
  credentials: {
    storefront: {
      clientId: import.meta.env.VITE_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
      // Bound at anonymous-login so prices.matchByContext can resolve.
      context: { currency: "CHF", siteCode: "main", targetLocation: "CH" },
    },
  },
});

/**
 * Root component. Holds the telemetry-counter state so the HUD can render
 * live counts and the EmporixProvider's onTelemetry can push into it.
 * In a real app, replace `pushEvent` with a Datadog / Sentry adapter.
 */
function Root(): React.JSX.Element {
  const { pushEvent, counts } = useTelemetryBridge();
  return (
    <BrowserRouter>
      <EmporixProvider
        client={client}
        storage={createLocalStorageStorage()}
        onTelemetry={pushEvent}
      >
        <App />
        <TelemetryHUD counts={counts} />
      </EmporixProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
