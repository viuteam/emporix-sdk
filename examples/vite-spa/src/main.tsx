import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createLocalStorageStorage } from "@viu/emporix-sdk-react";
import { App } from "./App";
import { TelemetryHUD, useTelemetryBridge } from "./TelemetryHUD";

const tenant = import.meta.env.VITE_EMPORIX_TENANT ?? "mytenant";

/** `vite --mode bff`: no token in the browser — see bff-dev-proxy.ts and docs/bff.md. */
const bff = import.meta.env.MODE === "bff";

const client = bff
  ? new EmporixClient({
      tenant,
      host: "/emporix",
      credentials: {},
      proxy: { headers: { "X-CSRF": "1" } },
    })
  : new EmporixClient({
      tenant,
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
function Root({ authenticated }: { authenticated: boolean }): React.JSX.Element {
  const { pushEvent, counts } = useTelemetryBridge();
  return (
    <BrowserRouter>
      <EmporixProvider
        client={client}
        storage={createLocalStorageStorage()}
        onTelemetry={pushEvent}
        {...(bff
          ? {
              // The dev BFF is guest-only, so there is no login or logout to delegate to.
              proxySession: { authenticated },
              // Its 401 means "no session"; reloading starts a new one.
              onCustomerSessionExpired: () => location.reload(),
            }
          : {})}
      >
        <App />
        <TelemetryHUD counts={counts} />
      </EmporixProvider>
    </BrowserRouter>
  );
}

const root = createRoot(document.getElementById("root")!);
const start = (authenticated: boolean): void =>
  root.render(
    <StrictMode>
      <Root authenticated={authenticated} />
    </StrictMode>,
  );

if (bff) {
  // Ask the BFF who is signed in before the first render. This one also starts
  // the guest session the proxied calls need.
  fetch("/bff/session", { headers: { "X-CSRF": "1" } })
    .then((r) => r.json() as Promise<{ authenticated: boolean }>)
    .then((s) => start(s.authenticated), () => start(false));
} else {
  start(false);
}
