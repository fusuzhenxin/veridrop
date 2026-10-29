import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const outDir = resolve(root, "public", "media", "stations");
const DEFAULT = "/img/station-default.png";
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
mkdirSync(outDir, { recursive: true });
const verd = JSON.parse(readFileSync(verdPath, "utf8"));

function safeName(token) {
  return String(token || "station").replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
}

function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return ".png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.length >= 6 && buf.slice(0, 3).toString() === "GIF") return ".gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return ".webp";
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return ".ico";
  const head = buf.slice(0, 240).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return ".svg";
  return "";
}

function requestOnce(targetUrl, timeout, limit) {
  const target = new URL(targetUrl);
  return new Promise((resolvePromise, reject) => {
    const fail = (error) => reject(error instanceof Error ? error : new Error(String(error || "error")));
    const timer = setTimeout(() => fail(new Error("timeout")), timeout);
    const finish = (status, headers, chunks) => {
      clearTimeout(timer);
      resolvePromise({ status, headers, body: Buffer.concat(chunks) });
    };
    const collect = (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          res.destroy();
          finish(res.statusCode || 0, res.headers, chunks);
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish(res.statusCode || 0, res.headers, chunks));
    };
    if (target.protocol === "http:") {
      const req = http.request({
        host: proxyUrl.hostname,
        port: proxyUrl.port || 80,
        method: "GET",
        path: target.href,
        timeout,
        headers: { Host: target.host, "User-Agent": "Mozilla/5.0", Accept: "image/*,text/html,*/*" },
      }, collect);
      req.on("error", fail);
      req.on("timeout", () => fail(new Error("timeout")));
      req.end();
      return;
    }
    const connect = http.request({
      host: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      timeout,
    });
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`proxy ${res.statusCode}`));
        return;
      }
      let pathName = "/";
      try {
        pathName = target.pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/") + target.search;
      } catch {
        pathName = target.pathname + target.search;
      }
      let req;
      try {
        req = https.request({
          host: target.hostname,
          servername: /^[0-9.]+$/.test(target.hostname) ? undefined : target.hostname,
          path: pathName || "/",
          method: "GET",
          socket,
          agent: false,
          headers: { Host: target.host, "User-Agent": "Mozilla/5.0", Accept: "image/*,text/html,*/*" },
        }, collect);
      } catch (error) {
        socket.destroy();
        fail(error);
        return;
      }
      req.on("error", fail);
      req.end();
    });
    connect.on("error", fail);
    connect.on("timeout", () => fail(new Error("timeout")));
    connect.end();
  });
}

async function fetchUrl(targetUrl, limit) {
  let current = targetUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await requestOnce(current, 10000, limit);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return { status: res.status, body: res.body, url: current, type: String(res.headers["content-type"] || "") };
  }
  return { status: 310, body: Buffer.alloc(0), url: current, type: "" };
}

function candidatesFromHtml(html, pageUrl) {
  const found = [];
  const dataUri = html.match(/rel=["'][^"']*icon[^"']*["'][^>]*href=["'](data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[^"']+)["']/i)
    || html.match(/href=["'](data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/i);
  if (dataUri) found.push(dataUri[1]);
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/icon/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i);
    if (href && !href[1].startsWith("data:")) found.push(href[1]);
  }
  const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (og) found.push(og[1]);
  for (const path of ["/logo.png", "/logo.svg", "/favicon.png", "/favicon.ico", "/apple-touch-icon.png"]) found.push(path);
  const urls = [];
  for (const href of found) {
    if (href.startsWith("data:")) {
      urls.push(href);
      continue;
    }
    try { urls.push(new URL(href, pageUrl).href); } catch { /* skip */ }
  }
  return [...new Set(urls)];
}

function saveBuffer(buf, token) {
  const ext = sniff(buf);
  if (!ext || buf.length < 80) return "";
  const name = `${safeName(token)}${ext}`;
  writeFileSync(resolve(outDir, name), buf);
  return `/media/stations/${name}`;
}

async function imageFromUrl(url, token) {
  if (url.startsWith("data:image/")) {
    const match = url.match(/^data:image\/[a-z0-9+.-]+;base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return "";
    return saveBuffer(Buffer.from(match[1].replace(/\s/g, ""), "base64"), token);
  }
  const res = await fetchUrl(url, 1500000);
  if (res.status < 200 || res.status >= 400) return "";
  if (/text\/html/i.test(res.type)) return "";
  return saveBuffer(res.body, token);
}

const jobs = (verd.stations || []).filter((row) => row.logo === DEFAULT && /^https?:\/\//i.test(row.url || ""));
console.log(JSON.stringify({ missing: jobs.length }));
let saved = 0;
let done = 0;
const queue = jobs.slice();

async function one(row) {
  const pageUrl = row.url;
  let local = "";
  try {
    const page = await fetchUrl(pageUrl, 500000);
    const html = page.body.toString("utf8");
    if (page.status >= 200 && page.status < 400) {
      for (const icon of candidatesFromHtml(html, page.url || pageUrl)) {
        local = await imageFromUrl(icon, row.token || row.id);
        if (local) break;
      }
    }
  } catch { /* keep default */ }
  if (local) {
    row.logo = local;
    saved += 1;
  }
  done += 1;
  if (done % 50 === 0) {
    writeFileSync(verdPath, JSON.stringify(verd));
    console.log(JSON.stringify({ done, saved, left: jobs.length - done }));
  }
}

await Promise.all(Array.from({ length: 10 }, async () => {
  while (queue.length) await one(queue.shift());
}));
writeFileSync(verdPath, JSON.stringify(verd));
console.log(JSON.stringify({ done, saved, stillDefault: (verd.stations || []).filter((row) => row.logo === DEFAULT).length }));
