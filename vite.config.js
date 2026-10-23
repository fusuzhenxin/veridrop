import dns from "node:dns/promises";
import net from "node:net";
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
      const allow = new Set(["authorization", "x-api-key", "anthropic-version", "content-type", "accept"]);
      for (const [key, value] of Object.entries(payload.headers || {})) {
        if (allow.has(key.toLowerCase()) && typeof value === "string" && value.length < 8000) headers[key] = value;
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

export default defineConfig({
  plugins: [react(), officialStatus(), localProbe()],
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
});
