import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createLocalStorageStorage } from "@viu/emporix-sdk-react";
import { App } from "./App";

const client = new EmporixClient({
  tenant: import.meta.env.VITE_EMPORIX_TENANT ?? "mytenant",
  credentials: {
    backend: { clientId: "unused-in-spa", secret: "unused-in-spa" },
    storefront: { clientId: import.meta.env.VITE_EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <EmporixProvider client={client} storage={createLocalStorageStorage()}>
        <App />
      </EmporixProvider>
    </BrowserRouter>
  </StrictMode>,
);
