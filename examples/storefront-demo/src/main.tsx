import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/hanken-grotesk";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/shell.css";
import "./styles/catalog.css";
import "./styles/checkout.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
