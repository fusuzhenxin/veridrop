import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const catalogPath = resolve(root, "src", "catalog.json");
const verd = JSON.parse(readFileSync(verdPath, "utf8"));
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");

function hostOf(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "");
}

function requestOnce(targetUrl, timeout) {
  const target = new URL(targetUrl);
  return new Promise((resolve, reject) => {
    const fail = (error) => reject(error instanceof Error ? error : new Error(String(error || "error")));
    const timer = setTimeout(() => fail(new Error("timeout")), timeout);
    const done = (status, location) => {
      clearTimeout(timer);
      resolve({ status, location });
    };
    if (target.protocol === "http:") {
      const req = http.request({
        host: proxyUrl.hostname,
        port: proxyUrl.port || 80,
        method: "GET",
        path: target.href,
        timeout,
        headers: { Host: target.host, "User-Agent": "VeriDropCatalog/1.0", Accept: "text/html" },
      }, (res) => {
        res.resume();
        done(res.statusCode || 0, res.headers.location || "");
      });
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
      const req = https.request({
        host: target.hostname,
        servername: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        socket,
        agent: false,
        headers: { Host: target.host, "User-Agent": "VeriDropCatalog/1.0", Accept: "text/html" },
      }, (response) => {
        response.resume();
        done(response.statusCode || 0, response.headers.location || "");
      });
      req.on("error", fail);
      req.end();
    });
    connect.on("error", fail);
    connect.on("timeout", () => fail(new Error("timeout")));
    connect.end();
  });
}

async function fetchStatus(targetUrl) {
  let current = targetUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const res = await requestOnce(current, 12000);
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, current).href;
      continue;
    }
    return res.status;
  }
  return 310;
}

const probe = await fetchStatus("https://www.google.com/generate_204").catch((error) => String(error?.message || "fail"));
if (probe !== 204 && probe !== 200) {
  console.log(JSON.stringify({ proxy: "down", probe }));
  process.exit(1);
}

const targets = [];
const seen = new Set();
for (const row of verd.stations || []) {
  if (row.online !== false) continue;
  const host = hostOf(row.domain || row.host || row.url);
  const url = row.url || (host ? `https://${host}` : "");
  if (!host || !/^https?:\/\//i.test(url) || seen.has(host)) continue;
  seen.add(host);
  targets.push({ host, url, name: row.name });
}

async function check(item) {
  const started = Date.now();
  try {
    const status = await fetchStatus(item.url);
    const open = status >= 200 && status < 400;
    return { ...item, open, status, ms: Date.now() - started };
  } catch (error) {
    return { ...item, open: false, status: 0, ms: Date.now() - started, error: String(error?.cause?.code || error?.code || error?.name || "error").slice(0, 60) };
  }
}

const results = [];
let done = 0;
const queue = targets.slice();
await Promise.all(Array.from({ length: 16 }, async () => {
  while (queue.length) {
    results.push(await check(queue.shift()));
    done += 1;
    if (done % 50 === 0) console.log(JSON.stringify({ done, left: targets.length - done }));
  }
}));

const opened = new Set(results.filter((row) => row.open).map((row) => row.host));
const failed = new Set(results.filter((row) => !row.open).map((row) => row.host));
let healed = 0;
for (const row of verd.stations || []) {
  const host = hostOf(row.domain || row.host || row.url);
  if (opened.has(host)) {
    row.online = true;
    healed += 1;
  }
}
for (const row of verd.attach || []) {
  const host = hostOf(row.host);
  if (opened.has(host)) row.online = true;
  if (failed.has(host)) row.online = false;
}
const before = verd.stations.length;
const removedTokens = new Set();
verd.stations = verd.stations.filter((row) => {
  const host = hostOf(row.domain || row.host || row.url);
  if (!failed.has(host)) return true;
  if (row.token) removedTokens.add(row.token);
  return false;
});
if (Array.isArray(verd.attach)) verd.attach = verd.attach.filter((row) => !failed.has(hostOf(row.host)));
let removedCatalog = 0;
catalog.stations = (catalog.stations || []).filter((row) => {
  const host = hostOf(row.host || row.url);
  if (!failed.has(host)) {
    if (opened.has(host)) row.cnDown = false;
    return true;
  }
  removedCatalog += 1;
  return false;
});

writeFileSync(verdPath, JSON.stringify(verd));
writeFileSync(catalogPath, JSON.stringify(catalog));

function stripSitemap(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n").filter((line) => {
    const match = line.match(/\/site\/([^<]+)</);
    if (!match) return true;
    return !removedTokens.has(decodeURIComponent(match[1]));
  });
  writeFileSync(file, lines.join("\n"));
}

stripSitemap(resolve(root, "public", "sitemap-sites.xml"));
const summary = { checked: targets.length, opened: opened.size, removed: before - verd.stations.length, healed, removedCatalog };
writeFileSync("C:/Users/Admin/AppData/Local/Temp/veridrop-proxy-recheck.json", JSON.stringify({ summary, opened: [...opened], failed: results.filter((row) => !row.open).slice(0, 30) }));
console.log(JSON.stringify(summary));
