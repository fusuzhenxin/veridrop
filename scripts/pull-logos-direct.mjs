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
const only = (process.env.LOGO_ONLY || "").split(",").map((item) => item.trim()).filter(Boolean);
let jobs = (verd.stations || []).filter((row) => row.logo === DEFAULT && /^https?:\/\//i.test(row.url || ""));
if (only.length) jobs = jobs.filter((row) => only.some((host) => String(row.url || "").includes(host)));
console.log(JSON.stringify({ missing: jobs.length }));

function safeName(token) {
  return String(token || "station").replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
}

function encodePath(target) {
  try {
    return target.pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/") + target.search;
  } catch {
    return target.pathname + target.search;
  }
}

function sniff(buf) {
  if (!buf || buf.length < 40) return "";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return ".png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.length >= 6 && buf.slice(0, 3).toString() === "GIF") return ".gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return ".webp";
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && (buf[2] === 1 || buf[2] === 2) && buf[3] === 0) return ".ico";
  if (buf.length >= 12 && buf.slice(4, 8).toString() === "ftyp") {
    const brand = buf.slice(8, 12).toString();
    if (brand === "avif" || brand === "avis") return ".avif";
  }
  const head = buf.slice(0, 300).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return ".svg";
  return "";
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function requestRaw(targetUrl, { timeout, limit, proxy, insecure, referer }) {
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
    const headers = { Host: target.host, "User-Agent": "Mozilla/5.0", Accept: "image/*,application/json,text/html,*/*" };
    if (referer) headers.Referer = referer;
    if (!proxy && target.protocol === "https:") {
      let req;
      try {
        req = https.request({
          host: target.hostname,
          servername: /^[0-9.]+$/.test(target.hostname) ? undefined : target.hostname,
          port: target.port || undefined,
          path: encodePath(target) || "/",
          method: "GET",
          timeout,
          rejectUnauthorized: !insecure,
          headers,
        }, collect);
      } catch (error) {
        clearTimeout(timer);
        fail(error);
        return;
      }
      req.on("error", fail);
      req.on("timeout", () => fail(new Error("timeout")));
      req.end();
      return;
    }
    if (!proxy && target.protocol === "http:") {
      const req = http.request({
        host: target.hostname,
        port: target.port || 80,
        path: encodePath(target) || "/",
        method: "GET",
        timeout,
        headers,
      }, collect);
      req.on("error", fail);
      req.on("timeout", () => fail(new Error("timeout")));
      req.end();
      return;
    }
    if (target.protocol === "http:") {
      const req = http.request({
        host: proxyUrl.hostname,
        port: proxyUrl.port || 80,
        method: "GET",
        path: target.href,
        timeout,
        headers,
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
      let req;
      try {
        req = https.request({
          host: target.hostname,
          servername: /^[0-9.]+$/.test(target.hostname) ? undefined : target.hostname,
          path: encodePath(target) || "/",
          method: "GET",
          socket,
          agent: false,
          rejectUnauthorized: !insecure,
          headers,
        }, collect);
      } catch (error) {
        socket.destroy();
        clearTimeout(timer);
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

async function fetchUrl(targetUrl, limit, referer) {
  let current = targetUrl;
  let insecure = false;
  for (let hop = 0; hop < 4; hop += 1) {
    let res;
    let usedProxy = false;
    try {
      res = await requestRaw(current, { timeout: 8000, limit, proxy: false, insecure, referer });
    } catch (error) {
      const message = String(error && error.message || error);
      if (!insecure && /CERT_|UNABLE_TO_VERIFY|SELF_SIGNED|certificate|expired/i.test(message)) {
        insecure = true;
        hop -= 1;
        continue;
      }
      try {
        res = await requestRaw(current, { timeout: 9000, limit, proxy: true, insecure, referer });
        usedProxy = true;
      } catch {
        throw error;
      }
    }
    if (!usedProxy && [401, 403, 408, 429, 451, 502, 503].includes(res.status)) {
      try {
        const via = await requestRaw(current, { timeout: 9000, limit, proxy: true, insecure, referer });
        if (via.status >= 200 && via.status < 400) res = via;
      } catch { /* keep the direct response */ }
    }
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return { status: res.status, body: res.body, url: current, type: String(res.headers["content-type"] || "") };
  }
  return { status: 310, body: Buffer.alloc(0), url: current, type: "" };
}

function bufferFromDataUri(url) {
  if (!url.startsWith("data:image/")) return null;
  const base64 = url.match(/^data:image\/[a-z0-9+.-]+;base64,([a-z0-9+/=\s]+)$/i);
  if (base64) {
    try { return Buffer.from(base64[1].replace(/\s/g, ""), "base64"); } catch { return null; }
  }
  const svg = url.match(/^data:image\/svg\+xml(?:;charset=[^,]*)?,(.*)$/i);
  if (!svg) return null;
  let text = svg[1];
  try { text = decodeURIComponent(text); } catch { /* keep raw */ }
  if (!/<svg/i.test(text)) return null;
  return Buffer.from(text);
}

function saveBuffer(buf, token) {
  const ext = sniff(buf);
  if (!ext) return "";
  const head = buf.slice(0, 80).toString("utf8").toLowerCase();
  if (ext === ".svg" && /<html|<!doctype/.test(head)) return "";
  const name = `${safeName(token)}${ext}`;
  writeFileSync(resolve(outDir, name), buf);
  return `/media/stations/${name}`;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
  return match ? match[2].trim() : "";
}

function pushUrl(list, href, base) {
  href = decodeHtml(href);
  if (!href || href === "data:," || href === "data:,") return;
  if (href.startsWith("data:")) {
    list.push(href);
    return;
  }
  try { list.push(new URL(href, base).href); } catch { /* skip */ }
}

function logosFromJson(value, out, depth) {
  if (!value || depth > 6 || out.length > 6) return;
  if (typeof value === "string") return;
  if (typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      const text = item.trim();
      if (/logo|favicon|icon/i.test(key) && text && (/^(https?:)?\/\//i.test(text) || text.startsWith("/") || text.startsWith("data:image/"))) {
        out.push(text);
      } else if (/<(img|link)\b/i.test(text) && /logo|icon|favicon/i.test(text) && text.length < 200000) {
        const tags = text.match(/<(?:img|link)\b[^>]*>/gi) || [];
        for (const tag of tags) {
          if (!/logo|icon|favicon/i.test(tag)) continue;
          const href = attr(tag, "src") || attr(tag, "href");
          if (href) out.push(href);
        }
      }
    } else if (item && typeof item === "object") {
      logosFromJson(item, out, depth + 1);
    }
  }
}

function candidatesFromHtml(html, pageUrl) {
  const found = [];
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/icon/i.test(tag)) continue;
    const href = attr(tag, "href");
    if (href) pushUrl(found, href, pageUrl);
  }
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    const key = `${attr(tag, "property")} ${attr(tag, "name")}`.toLowerCase();
    if (!/tileimage|og:image/.test(key)) continue;
    const href = attr(tag, "content");
    if (href && (key.includes("tile") || /logo|icon|favicon/i.test(href))) pushUrl(found, href, pageUrl);
  }
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgs) {
    if (!/logo|icon|favicon/i.test(tag)) continue;
    const href = attr(tag, "src");
    if (href) pushUrl(found, href, pageUrl);
  }
  return found;
}

async function imageFromUrl(url, token, referer) {
  const inline = bufferFromDataUri(decodeHtml(url));
  if (inline) return saveBuffer(inline, token);
  if (!/^https?:\/\//i.test(url)) return "";
  const res = await fetchUrl(url, 1500000, referer);
  if (res.status < 200 || res.status >= 400) return "";
  if (/text\/html/i.test(res.type) && !sniff(res.body)) return "";
  return saveBuffer(res.body, token);
}

function refreshTarget(html, base) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/refresh/i.test(attr(tag, "http-equiv"))) continue;
    const content = attr(tag, "content");
    const url = content.match(/url\s*=\s*(.+)$/i);
    if (!url) continue;
    const raw = decodeHtml(url[1].trim().replace(/^['"]|['"]$/g, ""));
    try { return new URL(raw, base).href; } catch { return ""; }
  }
  return "";
}

async function one(row) {
  const pageUrl = row.url;
  let origin = pageUrl;
  try { origin = new URL(pageUrl).origin; } catch { /* keep */ }
  let html = "";
  let finalUrl = pageUrl;
  let statusBody = "";
  const [pageResult, statusResult] = await Promise.all([
    fetchUrl(pageUrl, 800000).catch(() => null),
    fetchUrl(`${origin}/api/status`, 800000).catch(() => null),
  ]);
  if (pageResult && pageResult.status >= 200 && pageResult.status < 400) {
    html = pageResult.body.toString("utf8");
    finalUrl = pageResult.url || pageUrl;
    const jump = html.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
    if (jump && html.length < 800 && !/icon/i.test(html)) {
      try {
        const next = new URL(jump[1], finalUrl);
        if (next.origin === new URL(finalUrl).origin) {
          const landed = await fetchUrl(next.href, 800000).catch(() => null);
          if (landed && landed.status >= 200 && landed.status < 400) {
            html = landed.body.toString("utf8");
            finalUrl = landed.url || next.href;
          }
        }
      } catch { /* keep first page */ }
    }
  }
  if (statusResult && statusResult.status >= 200 && statusResult.status < 400) {
    const text = statusResult.body.toString("utf8").trim();
    if (text.startsWith("{") || text.startsWith("[")) statusBody = text;
  }
  if (process.env.LOGO_REFRESH === "1") {
    if (!html) return "";
    const next = refreshTarget(html, finalUrl);
    if (!next) return "";
    const landed = await fetchUrl(next, 800000).catch(() => null);
    if (!landed || landed.status < 200 || landed.status >= 400) return "";
    const landedHtml = landed.body.toString("utf8");
    const landedUrl = landed.url || next;
    for (const icon of candidatesFromHtml(landedHtml, landedUrl)) {
      try {
        const savedIcon = await imageFromUrl(icon, row.token || row.id, landedUrl);
        if (savedIcon) return savedIcon;
      } catch { /* try the next icon */ }
    }
    return "";
  }
  const pageOpened = Boolean(html);
  if (!pageOpened && !statusBody) {
    try { return await imageFromUrl(`${origin}/favicon.ico`, row.token || row.id, `${origin}/`); } catch { return ""; }
  }
  const statusLogos = [];
  if (statusBody) {
    try { logosFromJson(JSON.parse(statusBody), statusLogos, 0); } catch { /* not json */ }
  }
  const ordered = [];
  for (const href of statusLogos) pushUrl(ordered, href, origin + "/");
  for (const href of candidatesFromHtml(html, finalUrl)) ordered.push(href);
  for (const path of ["/logo.png", "/logo.svg", "/favicon.svg", "/favicon.png", "/apple-touch-icon.png", "/favicon.ico"]) {
    pushUrl(ordered, path, origin + "/");
  }
  const seen = new Set();
  let local = "";
  for (const icon of ordered) {
    if (!icon || seen.has(icon)) continue;
    seen.add(icon);
    try {
      local = await imageFromUrl(icon, row.token || row.id, origin + "/");
    } catch { local = ""; }
    if (local) break;
  }
  if (!local && html) {
    const manifest = html.match(/<link\b[^>]*rel=["'][^"']*manifest[^"']*["'][^>]*>/i);
    const href = manifest && attr(manifest[0], "href");
    if (href) {
      try {
        const manifestUrl = new URL(href, finalUrl).href;
        const file = await fetchUrl(manifestUrl, 300000);
        const json = JSON.parse(file.body.toString("utf8"));
        for (const icon of json.icons || []) {
          if (!icon.src) continue;
          local = await imageFromUrl(new URL(icon.src, manifestUrl).href, row.token || row.id, origin + "/");
          if (local) break;
        }
      } catch { /* no manifest icon */ }
    }
  }
  if (!local && html) {
    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)]
      .map((match) => match[1])
      .filter((src) => !/cloudflare|email-decode|gtag|analytics|jquery/i.test(src))
      .slice(0, 1);
    if (scripts[0]) {
      try {
        const scriptUrl = new URL(scripts[0], finalUrl).href;
        const js = await fetchUrl(scriptUrl, 1200000);
        const text = js.body.toString("utf8");
        const matches = [...text.matchAll(/["']([^"']*(?:logo|favicon)[^"']*\.(?:png|svg|webp|jpg|jpeg|ico))["']/gi)].slice(0, 3);
        for (const match of matches) {
          local = await imageFromUrl(new URL(match[1], scriptUrl).href, row.token || row.id, origin + "/");
          if (local) break;
        }
      } catch { /* no bundled icon */ }
    }
  }
  return local;
}

const queue = jobs.slice();
let saved = 0;
let done = 0;

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    let local = "";
    try { local = await one(row); } catch { local = ""; }
    if (local) {
      row.logo = local;
      saved += 1;
    }
    done += 1;
    if (done % 25 === 0 || done === jobs.length) {
      if (!process.env.LOGO_SIDECAR) writeFileSync(verdPath, JSON.stringify(verd));
      console.log(JSON.stringify({ done, saved, left: jobs.length - done }));
    }
  }
}

await Promise.all(Array.from({ length: 8 }, () => worker()));
const found = {};
for (const row of jobs) {
  if (row.logo && row.logo !== DEFAULT) found[row.token] = row.logo;
}
if (process.env.LOGO_SIDECAR) {
  writeFileSync(process.env.LOGO_SIDECAR, JSON.stringify(found));
} else {
  writeFileSync(verdPath, JSON.stringify(verd));
}
const still = (verd.stations || []).filter((row) => row.logo === DEFAULT).length;
console.log(JSON.stringify({ done, saved, stillDefault: still, sidecar: Boolean(process.env.LOGO_SIDECAR) }));
