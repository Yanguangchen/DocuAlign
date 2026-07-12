/**
 * @file main.jsx
 * @description Application entry point for rendering the React workspace shell (`App.jsx`)
 * in strict mode and injecting the global design system (`styles.css`).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initObservability } from "./lib/observability.js";
import "./styles.css";

initObservability();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
