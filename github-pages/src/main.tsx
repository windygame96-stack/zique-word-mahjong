/// <reference types="vite/client" />

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/page";
import "../../app/globals.css";

declare global {
  interface Window {
    __ZIQUE_API_BASE__?: string;
  }
}

window.__ZIQUE_API_BASE__ = import.meta.env.VITE_ZIQUE_API_BASE || "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
