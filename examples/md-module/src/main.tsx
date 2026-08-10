import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RemoteComponent from "./RemoteComponent";

// Stands in for the host. The real dashboard imports ./RemoteComponent through
// module federation and supplies appState itself.
const appState = {
  tenant: import.meta.env.VITE_DEMO_TENANT ?? "",
  language: import.meta.env.VITE_DEMO_LANGUAGE ?? "en",
  token: import.meta.env.VITE_DEMO_TOKEN ?? "",
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RemoteComponent appState={appState} />
  </StrictMode>,
);
