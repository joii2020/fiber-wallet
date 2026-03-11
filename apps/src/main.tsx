import React from "react";
import ReactDOM from "react-dom/client";
import "./style.css";
import { App } from "./App";
import { CCCProvider } from "./components/CCCProvider";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app");
}

ReactDOM.createRoot(app).render(
  <React.StrictMode>
    <CCCProvider>
      <App />
    </CCCProvider>
  </React.StrictMode>
);
