import { useMemo } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createLocalStorageStorage } from "@viu/emporix-sdk-react";
import { ConfigGate } from "./config/ConfigGate";
import type { DemoConfig } from "./config/useDemoConfig";
import { AppShell } from "./app/AppShell";
import { ToastProvider } from "./app/Toasts";
import { RouteError } from "./app/RouteError";
import { pushTelemetry } from "./app/telemetry-store";
import { Placeholder } from "./pages/Placeholder";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Category } from "./pages/Category";
import { Product } from "./pages/Product";

function buildClient(c: DemoConfig): EmporixClient {
  const context: { siteCode?: string; currency?: string; targetLocation?: string } = {};
  if (c.siteCode) context.siteCode = c.siteCode;
  if (c.currency) context.currency = c.currency;
  if (c.targetLocation) context.targetLocation = c.targetLocation;
  return new EmporixClient({
    tenant: c.tenant,
    ...(c.host ? { host: c.host } : {}),
    credentials: {
      storefront: {
        clientId: c.storefrontClientId,
        ...(Object.keys(context).length ? { context } : {}),
      },
    },
    logger: { level: "warn" },
  });
}

function DemoApp({ config, reset }: { config: DemoConfig; reset: () => void }) {
  const client = useMemo(() => buildClient(config), [config]);
  const storage = useMemo(() => createLocalStorageStorage(), []);

  return (
    <EmporixProvider
      client={client}
      storage={storage}
      autoRefreshCustomerToken
      onTelemetry={pushTelemetry}
      {...(config.siteCode ? { initialSiteCode: config.siteCode } : {})}
    >
      <ToastProvider>
        <BrowserRouter>
          <AppShell tenant={config.tenant} onReset={reset}>
            <RouteError>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/search" element={<Search />} />
                <Route path="/category/:id" element={<Category />} />
                <Route path="/product/:idOrCode" element={<Product />} />
                <Route path="/cart" element={<Placeholder title="Cart" />} />
                <Route path="/checkout" element={<Placeholder title="Checkout" />} />
                <Route path="/account/*" element={<Placeholder title="Account" />} />
                <Route path="/reset-password" element={<Placeholder title="Reset password" />} />
                <Route path="*" element={<Placeholder title="Not found" />} />
              </Routes>
            </RouteError>
          </AppShell>
        </BrowserRouter>
      </ToastProvider>
    </EmporixProvider>
  );
}

export function App() {
  return <ConfigGate>{(config, reset) => <DemoApp config={config} reset={reset} />}</ConfigGate>;
}
