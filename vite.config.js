import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loadOfficial } from "./server/official-live.mjs";

function privateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return true;
}

async function publicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("bad");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad");
  if (url.username || url.password) throw new Error("userinfo");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error("private");
  }
  if (net.isIP(host)) {
    if (privateIp(host)) throw new Error("private");
    return url;
  }
  const looked = await dns.lookup(host, { all: true });
  if (!looked.length || looked.some((item) => privateIp(item.address))) throw new Error("private");
  return url;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function officialStatus() {
  const handle = async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    const match = path.match(/^\/api\/official\/([a-z0-9_-]+)$/);
    if (!match) return next();
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("cache-control", "no-store");
      res.end();
      return;
    }
    try {
      const board = await loadOfficial(match[1]);
      if (!board) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.statusCode = board.level === "unknown" ? 502 : 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(board));
    } catch {
      if (res.writableEnded) return;
      res.statusCode = 502;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify({ level: "unknown" }));
    }
  };
  return {
    name: "official-status",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

function localProbe() {
  const handle = async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (path !== "/__probe") return next();
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const payload = JSON.parse(await readBody(req, 1_500_000));
      const url = await publicUrl(payload.url);
      const headers = {};
      const allow = new Set(["authorization", "x-api-key", "anthropic-version", "content-type", "accept", "anthropic-beta", "user-agent", "x-stainless-lang", "x-stainless-os", "x-stainless-runtime", "x-stainless-runtime-version", "x-stainless-package-version"]);
      for (const [key, value] of Object.entries(payload.headers || {})) {
        if (allow.has(key.toLowerCase()) && typeof value === "string" && value.length < 8000 && !/[\r\n]/.test(value)) headers[key] = value;
      }
      const method = payload.method === "GET" ? "GET" : "POST";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(Number(payload.timeoutMs) || 60000, 90000));
      const upstream = await fetch(url, {
        method,
        headers,
        body: method === "GET" ? undefined : typeof payload.body === "string" ? payload.body : undefined,
        signal: controller.signal,
        redirect: "manual",
      });
      clearTimeout(timer);
      res.statusCode = 200;
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("x-upstream-status", String(upstream.status));
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-accel-buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      if (!upstream.body) {
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        res.write(Buffer.from(step.value));
      }
      res.end();
    } catch (error) {
      if (res.writableEnded) return;
      res.statusCode = error.message === "large" ? 413 : 502;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      const reason = error.name === "AbortError" ? "timeout" : error.message === "private" ? "private" : error.message === "bad" ? "bad" : "connect";
      res.end(reason);
    }
  };
  return {
    name: "local-probe",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

let communityProcess = null;

function ensureCommunity() {
  const socket = net.connect({ host: "127.0.0.1", port: 4175 });
  const giveUp = setTimeout(() => socket.destroy(), 400);
  socket.on("connect", () => {
    clearTimeout(giveUp);
    socket.end();
  });
  socket.on("error", () => {
    clearTimeout(giveUp);
    if (communityProcess && communityProcess.exitCode == null) return;
    communityProcess = spawn("python", ["server/community.py"], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      stdio: "ignore",
      windowsHide: true,
    });
  });
}

function communityApi() {
  ensureCommunity();
  const handle = (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/votes" && path !== "/api/comments" && path !== "/api/checkin" && path !== "/api/points" && !path.startsWith("/api/auth") && !path.startsWith("/api/account")) return next();
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: 4175,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1:4175" },
      },
      (upstream) => {
        res.statusCode = upstream.statusCode || 502;
        for (const [key, value] of Object.entries(upstream.headers)) {
          if (value != null && key !== "transfer-encoding") res.setHeader(key, value);
        }
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      if (res.writableEnded) return;
      res.statusCode = 502;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify({ error: "登录和投票服务没有开" }));
    });
    req.pipe(proxy);
  };
  return {
    name: "community-api",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

function readCommunity() {
  try {
    return JSON.parse(fs.readFileSync(new URL("./data/community.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

function ssrRouterEsm() {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const files = {
    "react-router-dom": path.join(root, "node_modules/react-router-dom/dist/index.mjs"),
    "react-router": path.join(root, "node_modules/react-router/dist/development/index.mjs"),
    "react-router/dom": path.join(root, "node_modules/react-router/dist/development/dom-export.mjs"),
  };
  return {
    name: "ssr-router-esm",
    enforce: "pre",
    resolveId(id) {
      if (this.environment?.name !== "ssr") return null;
      return files[id] || null;
    },
  };
}

function utf8Text() {
  const root = fileURLToPath(new URL("./public", import.meta.url));
  const handle = (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const urlPath = decodeURIComponent((req.url || "").split("?")[0]);
    if (!/\.(txt|md)$/i.test(urlPath)) return next();
    const file = path.normalize(path.join(root, urlPath.replace(/^\/+/, "")));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  };
  return {
    name: "utf8-text",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

function htmlSnapshot() {
  const serve = (server) => {
    server.middlewares.use(async (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const path = (req.url || "").split("?")[0];
      if (path.startsWith("/station/")) {
        const slug = decodeURIComponent(path.slice("/station/".length).split("/")[0] || "");
        let target = `/site/${slug}`;
        try {
          const mapping = JSON.parse(fs.readFileSync(new URL("./data/station-redirects.json", import.meta.url), "utf8"));
          if (mapping[slug]) target = mapping[slug];
        } catch { /* keep the plain /site path */ }
        res.statusCode = 301;
        res.setHeader("Location", target);
        res.setHeader("Content-Length", "0");
        res.end();
        return;
      }
      if (path.startsWith("/@") || path.startsWith("/src/") || path.startsWith("/node_modules/") || path.startsWith("/api/")) return next();
      if (/\.[a-zA-Z0-9]+$/.test(path)) return next();
      const accept = req.headers.accept || "";
      if (accept && !accept.includes("text/html") && !accept.includes("*/*")) return next();
      try {
        const mod = await server.ssrLoadModule("/src/html-snapshot.js");
        const page = mod.renderSnapshot(path, readCommunity());
        if ((page.status || 200) === 200) {
          try {
            const app = await server.ssrLoadModule("/src/entry-server.jsx");
            page.markup = app.renderPage(req.url || path);
          } catch (error) {
            server.config.logger.error(error);
          }
        }
        const template = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
        const transformed = await server.transformIndexHtml(path, template);
        const html = mod.injectSnapshot(transformed, page);
        res.statusCode = page.status || 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(html);
      } catch (error) {
        next(error);
      }
    });
  };
  return {
    name: "html-snapshot",
    configureServer(server) {
      serve(server);
    },
    configurePreviewServer(server) {
      serve(server);
    },
  };
}

export default defineConfig({
  plugins: [utf8Text(), ssrRouterEsm(), react(), communityApi(), officialStatus(), localProbe(), htmlSnapshot()],
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
  ssr: { noExternal: ["react-router", "react-router-dom"] },
});
