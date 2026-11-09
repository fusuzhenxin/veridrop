import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { Seo } from "./seo.jsx";
import { preloadRoutePrices } from "./prices.js";

preloadRoutePrices(window.location.pathname).finally(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <BrowserRouter>
        <Seo />
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
