import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const outDir = resolve(root, "public", "media", "stations");
const DEFAULT = "/img/station-default.png";
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
mkdirSync(outDir, { recursive: true });

function hostOf(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "");
}

function safeName(token) {
  return String(token || "station").replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
}

function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return ".png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.length >= 6 && buf.slice(0, 3).toString() === "GIF") return ".gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return ".webp";
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return ".ico";
  const head = buf.slice(0, 200).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<svg") || head.includes("<svg")) return ".svg";
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
          fail(new Error("too-large"));
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
        headers: { Host: target.host, "User-Agent": "VeriDropCatalog/1.0", Accept: "image/*,text/html" },
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
        const pathName = target.pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/") + target.search;
        req = https.request({
          host: target.hostname,
          servername: /^[0-9.]+$/.test(target.hostname) ? undefined : target.hostname,
          path: pathName,
          method: "GET",
          socket,
          agent: false,
          headers: { Host: target.host, "User-Agent": "VeriDropCatalog/1.0", Accept: "image/*,text/html" },
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
    const res = await requestOnce(current, 12000, limit);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return { status: res.status, body: res.body, url: current, type: String(res.headers["content-type"] || "") };
  }
  return { status: 310, body: Buffer.alloc(0), url: current, type: "" };
}

function iconFromHtml(html, pageUrl) {
  const links = [];
  const patterns = [
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi,
    /<meta[^>]+property=["']og:image["'][^>]*>/gi,
  ];
  for (const pattern of patterns) {
    for (const tag of html.match(pattern) || []) {
      const href = tag.match(/(?:href|content)=["']([^"']+)["']/i);
      if (href) links.push(href[1]);
    }
  }
  links.push("/favicon.ico");
  const out = [];
  for (const href of links) {
    try { out.push(new URL(href, pageUrl).href); } catch { /* skip bad href */ }
  }
  return out;
}

function needsFetch(logo) {
  const value = String(logo || "").trim();
  if (!value || value.startsWith(DEFAULT)) return "discover";
  if (/^https?:\/\//i.test(value)) return "remote";
  if (value.startsWith("/media/") || value.startsWith("/img/")) return "keep";
  return "discover";
}

async function saveImage(url, token) {
  const res = await fetchUrl(url, 1200000);
  if (res.status < 200 || res.status >= 400 || res.body.length < 80) return "";
  if (/text\/html/i.test(res.type)) return "";
  const ext = sniff(res.body) || ({
    ".png": ".png", ".jpg": ".jpg", ".jpeg": ".jpg", ".gif": ".gif", ".webp": ".webp", ".ico": ".ico", ".svg": ".svg",
  })[extname(new URL(res.url).pathname).toLowerCase()] || "";
  if (!ext) return "";
  const name = `${safeName(token)}${ext}`;
  writeFileSync(resolve(outDir, name), res.body);
  return `/media/stations/${name}`;
}

const verd = JSON.parse(readFileSync(resolve(root, "src", "verd-index.json"), "utf8"));
const jobs = (verd.stations || []).map((row, index) => ({ row, index, mode: needsFetch(row.logo) })).filter((job) => job.mode !== "keep");
console.log(JSON.stringify({ jobs: jobs.length }));
let saved = 0;
let fallback = 0;
let done = 0;
const queue = jobs.slice();

async function one(job) {
  const page = job.row.url || (job.row.domain ? `https://${job.row.domain}` : "");
  let local = "";
  try {
    if (job.mode === "remote") local = await saveImage(job.row.logo, job.row.token || job.row.id);
    if (!local && /^https?:\/\//i.test(page)) {
      const html = await fetchUrl(page, 160000);
      if (html.status >= 200 && html.status < 400 && /html|plain/i.test(html.type + html.body.slice(0, 200).toString("utf8"))) {
        for (const icon of iconFromHtml(html.body.toString("utf8"), html.url || page)) {
          local = await saveImage(icon, job.row.token || job.row.id);
          if (local) break;
        }
      }
    }
  } catch { /* use default */ }
  job.row.logo = local || DEFAULT;
  if (local) saved += 1;
  else fallback += 1;
  done += 1;
  if (done % 100 === 0) {
    writeFileSync(resolve(root, "src", "verd-index.json"), JSON.stringify(verd));
    console.log(JSON.stringify({ done, saved, fallback, left: jobs.length - done }));
  }
}

await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) await one(queue.shift());
}));
writeFileSync(resolve(root, "src", "verd-index.json"), JSON.stringify(verd));
console.log(JSON.stringify({ done, saved, fallback, kept: (verd.stations || []).length - jobs.length }));
