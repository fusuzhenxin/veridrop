import "./ssr-dom.js";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import App from "./App.jsx";

function applyRequestLocation(url) {
  const loc = globalThis.location;
  if (!loc || typeof loc.href !== "string") return;
  const raw = String(url || "/").split("#")[0] || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const queryAt = path.indexOf("?");
  loc.pathname = queryAt >= 0 ? path.slice(0, queryAt) || "/" : path;
  loc.search = queryAt >= 0 ? path.slice(queryAt) : "";
  loc.href = `${loc.origin}${loc.pathname}${loc.search}`;
}

export function renderPage(url, options = {}) {
  globalThis.__VERD_STATIC__ = Boolean(options.static);
  globalThis.__VERD_COMMUNITY__ = options.community || null;
  try {
    applyRequestLocation(url);
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
