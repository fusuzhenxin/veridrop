import "./ssr-dom.js";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import App from "./App.jsx";

export function renderPage(url, options = {}) {
  globalThis.__VERD_STATIC__ = Boolean(options.static);
  globalThis.__VERD_COMMUNITY__ = options.community || null;
  try {
    const location = String(url || "/").split("#")[0] || "/";
    const html = renderToString(
      <StaticRouter location={location}>
        <App />
      </StaticRouter>,
    );
    return html.replace(/></g, ">\n<");
  } finally {
    globalThis.__VERD_STATIC__ = false;
    globalThis.__VERD_COMMUNITY__ = null;
  }
}
