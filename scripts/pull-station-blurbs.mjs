import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const factPath = resolve(root, "data", "station-blurbs.json");
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
mkdirSync(resolve(root, "data"), { recursive: true });

const verd = JSON.parse(readFileSync(verdPath, "utf8"));
let saved = {};
try { saved = JSON.parse(readFileSync(factPath, "utf8")); } catch { saved = {}; }
saved.checked = saved.checked || {};

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* wait */ }
}

function saveJson(path, data) {
  const text = JSON.stringify(data);
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      renameSync(tmp, path);
      return;
    } catch {
      sleep(250);
    }
  }
  writeFileSync(path, text);
}

function clean(value) {
  return String(value || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function junk(text, name) {
  const value = clean(text);
  if (value.length < 20 || value.length > 320) return true;
  if (/just a moment|attention required|enable javascript|cloudflare|access denied|403 forbidden|404 not found|nginx|欢迎使用|请登录|sign in/i.test(value)) return true;
  const station = clean(name);
  if (station && value.replace(/\s/g, "") === station.replace(/\s/g, "")) return true;
  return false;
}

function requestRaw(targetUrl, { timeout, limit, proxy }) {
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
    const headers = {
      Host: target.host,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/json,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    };
    const path = `${target.pathname}${target.search}` || "/";
    if (!proxy) {
      const lib = target.protocol === "http:" ? http : https;
      const req = lib.request({
        host: target.hostname,
        servername: target.protocol === "https:" && !/^[0-9.]+$/.test(target.hostname) ? target.hostname : undefined,
        port: target.port || undefined,
        path, method: "GET", timeout, headers,
      }, collect);
      req.on("error", fail);
      req.end();
      return;
    }
    const connect = http.request({
      host: proxyUrl.hostname, port: proxyUrl.port || 80, method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`, timeout,
    });
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(new Error("proxy"));
        return;
      }
      const req = https.request({
        host: target.hostname,
        servername: /^[0-9.]+$/.test(target.hostname) ? undefined : target.hostname,
        path, method: "GET", socket, agent: false, headers,
      }, collect);
      req.on("error", fail);
      req.end();
    });
    connect.on("error", fail);
    connect.end();
  });
}

const proxyHosts = new Set();
async function fetchUrl(targetUrl, limit = 350000) {
  let current = targetUrl;
  let useProxy = false;
  try { useProxy = proxyHosts.has(new URL(current).host); } catch { /* keep */ }
  for (let hop = 0; hop < 3; hop += 1) {
    let res;
    try {
      res = await requestRaw(current, { timeout: 8000, limit, proxy: useProxy });
    } catch {
      if (useProxy) return { status: 0, body: "" };
      useProxy = true;
      try { proxyHosts.add(new URL(current).host); } catch { /* skip */ }
      try { res = await requestRaw(current, { timeout: 9000, limit, proxy: true }); }
      catch { return { status: 0, body: "" }; }
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).href;
      continue;
    }
    return { status: res.status, body: res.body.toString("utf8") };
  }
  return { status: 310, body: "" };
}

function fromHtml(html, name) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && !junk(match[1], name)) return clean(match[1]).slice(0, 220);
  }
  const plain = clean(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
  const sentence = plain.split(/(?<=[。！？])/).find((part) => !junk(part, name));
  return sentence ? sentence.slice(0, 220) : "";
}

function fromAbout(body, name) {
  let text = body;
  try {
    const json = JSON.parse(body);
    text = JSON.stringify(json.data || json);
  } catch { /* html */ }
  return fromHtml(String(text), name);
}

function mentions(text, row) {
  const plain = text.toLowerCase();
  const host = String(row.domain || "").toLowerCase();
  const name = String(row.name || "").toLowerCase();
  return (host && plain.includes(host)) || (name.length >= 3 && plain.includes(name));
}

async function searchBlurb(row) {
  const query = `"${row.domain || row.name || ""}"`;
  const page = await fetchUrl(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, 400000);
  const links = [];
  const re = /<h2[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"/gi;
  let match;
  while ((match = re.exec(page.body || "")) && links.length < 4) {
    try {
      const next = new URL(match[1]);
      if (/bing\.com|microsoft\.com|baidu\.com/i.test(next.host)) continue;
      if (row.domain && next.host.endsWith(row.domain)) continue;
      links.push(next.href);
    } catch { /* skip */ }
  }
  const nameSlug = String(row.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hostSlug = String(row.domain || "").toLowerCase().replace(/\./g, "-");
  const guesses = [
    nameSlug ? `https://ccnavx.com/zh/sites/${nameSlug}` : "",
    hostSlug ? `https://apitokennav.com/sites/${hostSlug}/` : "",
  ].filter(Boolean);
  for (const link of [...guesses, ...links].slice(0, 5)) {
    const found = await fetchUrl(link, 250000).catch(() => null);
    if (!found || found.status < 200 || found.status >= 400) continue;
    const plain = clean(found.body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
    if (!mentions(plain, row)) continue;
    const sentence = plain.split(/(?<=[。！？])/).find((part) => mentions(part, row) && !junk(part, row.name));
    if (sentence) return sentence.slice(0, 220);
  }
  return "";
}

let jobs = (verd.stations || []).filter((row) => !clean(row.description) && /^https?:\/\//i.test(row.url || ""));
if (process.env.BLURB_RETRY !== "1") jobs = jobs.filter((row) => !saved.checked[row.token]);
console.log(JSON.stringify({ todo: jobs.length }));
const queue = jobs.slice();
let done = 0;
let filled = 0;

async function one(row) {
  let origin = "";
  try { origin = new URL(row.url).origin; } catch { return ""; }
  const pages = await Promise.all([
    fetchUrl(row.url).catch(() => null),
    fetchUrl(`${origin}/api/about`).catch(() => null),
    fetchUrl(`${origin}/api/notice`).catch(() => null),
    fetchUrl(`${origin}/api/status`).catch(() => null),
  ]);
  const status = pages[3];
  if (status && status.status >= 200 && status.status < 400) {
    try {
      const data = JSON.parse(status.body).data || {};
      const blob = [data.footer_html, data.footer, data.about, data.home_page_content, data.description].filter(Boolean).join(" ");
      const text = fromHtml(String(blob), row.name);
      if (text) return text;
    } catch { /* not json */ }
  }
  for (const page of pages) {
    if (!page || page.status < 200 || page.status >= 400) continue;
    const text = page === pages[0] ? fromHtml(page.body, row.name) : fromAbout(page.body, row.name);
    if (text) return text;
  }
  return searchBlurb(row);
}

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    let text = "";
    try { text = await one(row); } catch { text = ""; }
    if (text) {
      row.description = text;
      filled += 1;
    }
    saved.checked[row.token] = text ? text.slice(0, 80) : "";
    done += 1;
    if (done % 20 === 0 || done === jobs.length) {
      saveJson(verdPath, verd);
      saveJson(factPath, saved);
      console.log(JSON.stringify({ done, left: jobs.length - done, filled }));
    }
  }
}

await Promise.all(Array.from({ length: 6 }, () => worker()));
const counts = new Map();
for (const row of verd.stations) {
  const text = clean(row.description);
  if (text) counts.set(text, (counts.get(text) || 0) + 1);
}
let cleared = 0;
for (const row of verd.stations) {
  const text = clean(row.description);
  if (text && counts.get(text) >= 5) {
    row.description = "";
    cleared += 1;
  }
}
saveJson(verdPath, verd);
saveJson(factPath, saved);
const blank = verd.stations.filter((row) => !clean(row.description)).length;
console.log(JSON.stringify({ done, filled, cleared, blank }));
