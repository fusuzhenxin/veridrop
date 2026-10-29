import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const factPath = resolve(root, "data", "station-nav-blurbs.json");
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
mkdirSync(resolve(root, "data"), { recursive: true });
const verd = JSON.parse(readFileSync(verdPath, "utf8"));

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* wait */ }
}
function saveJson(path, data) {
  const text = JSON.stringify(data);
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { renameSync(tmp, path); return; } catch { sleep(250); }
  }
  writeFileSync(path, text);
}
function clean(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function junk(text, name) {
  const value = clean(text);
  if (value.length < 20 || value.length > 320) return true;
  if (/just a moment|cloudflare|access denied|404 not found|nginx|请登录|sign in|正在加载/i.test(value)) return true;
  if (name && value.replace(/\s/g, "") === clean(name).replace(/\s/g, "")) return true;
  return false;
}
function requestRaw(targetUrl, { timeout, limit, proxy }) {
  const target = new URL(targetUrl);
  return new Promise((resolvePromise, reject) => {
    const fail = (error) => reject(error instanceof Error ? error : new Error(String(error || "error")));
    const timer = setTimeout(() => fail(new Error("timeout")), timeout);
    const finish = (status, headers, chunks) => { clearTimeout(timer); resolvePromise({ status, headers, body: Buffer.concat(chunks) }); };
    const collect = (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > limit) { res.destroy(); finish(res.statusCode || 0, res.headers, chunks); return; } chunks.push(chunk); });
      res.on("end", () => finish(res.statusCode || 0, res.headers, chunks));
    };
    const headers = { Host: target.host, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", Accept: "text/html", "Accept-Language": "zh-CN,zh;q=0.9" };
    const path = `${target.pathname}${target.search}` || "/";
    if (!proxy) {
      const lib = target.protocol === "http:" ? http : https;
      const req = lib.request({ host: target.hostname, servername: target.protocol === "https:" && !/^[0-9.]+$/.test(target.hostname) ? target.hostname : undefined, port: target.port || undefined, path, method: "GET", timeout, headers }, collect);
      req.on("error", fail); req.end(); return;
    }
    const connect = http.request({ host: proxyUrl.hostname, port: proxyUrl.port || 80, method: "CONNECT", path: `${target.hostname}:${target.port || 443}`, timeout });
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); fail(new Error("proxy")); return; }
      const req = https.request({ host: target.hostname, servername: /^[0-9.]+$/.test(target.hostname) ? undefined : target.hostname, path, method: "GET", socket, agent: false, headers }, collect);
      req.on("error", fail); req.end();
    });
    connect.on("error", fail); connect.end();
  });
}
const proxyHosts = new Set();
async function fetchUrl(targetUrl, limit = 500000) {
  let current = targetUrl;
  let useProxy = false;
  try { useProxy = proxyHosts.has(new URL(current).host); } catch { /* keep */ }
  for (let hop = 0; hop < 3; hop += 1) {
    let res;
    try { res = await requestRaw(current, { timeout: 9000, limit, proxy: useProxy }); }
    catch {
      if (useProxy) return { status: 0, body: "" };
      useProxy = true;
      try { proxyHosts.add(new URL(current).host); } catch { /* skip */ }
      try { res = await requestRaw(current, { timeout: 10000, limit, proxy: true }); } catch { return { status: 0, body: "" }; }
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) { current = new URL(res.headers.location, current).href; continue; }
    return { status: res.status, body: res.body.toString("utf8") };
  }
  return { status: 310, body: "" };
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function sentence(text, name) {
  const plain = clean(text);
  const part = plain.split(/(?<=[。！？])/).find((item) => !junk(item, name));
  return part ? part.slice(0, 220) : "";
}

const byHost = new Map();
function remember(host, text, name) {
  const key = String(host || "").replace(/^www\./, "").toLowerCase();
  const blurb = sentence(text, name);
  if (!key || !blurb || byHost.has(key)) return;
  byHost.set(key, blurb);
}

async function harvestApisou() {
  const home = await fetchUrl("https://www.apisou.com/", 800000);
  const slugs = [...new Set([...(home.body.matchAll(/href="\/site\/([a-z0-9-]+)"/gi))].map((match) => match[1]))];
  console.log(JSON.stringify({ apisouSlugs: slugs.length }));
  const queue = slugs.slice();
  async function worker() {
    while (queue.length) {
      const slug = queue.shift();
      const page = await fetchUrl(`https://www.apisou.com/site/${slug}`, 400000);
      if (!page.body) continue;
      const plain = clean(page.body);
      const site = (plain.match(/官网\s*([a-z0-9.-]+\.[a-z]{2,})/i) || [])[1];
      const intro = (plain.match(/站点介绍\s+(.{20,280}?)(?:查看详细|支持的模型|旧资料)/) || [])[1] || "";
      if (site && intro) remember(site, intro, slug);
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  console.log(JSON.stringify({ apisouMatchedHosts: byHost.size }));
}

async function harvestTokenNav() {
  const home = await fetchUrl("https://apitokennav.com/", 900000);
  const plain = clean(home.body);
  const blocks = plain.split(/查看详情/).slice(0, 200);
  let added = 0;
  for (const block of blocks) {
    const host = (block.match(/\b([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)\b/i) || [])[1];
    const text = sentence(block, host);
    if (host && text) { remember(host, text, host); added += 1; }
  }
  console.log(JSON.stringify({ tokenNavAdded: added, hosts: byHost.size }));
}

const blanks = (verd.stations || []).filter((row) => !clean(row.description) && row.domain);
console.log(JSON.stringify({ blank: blanks.length }));
await harvestApisou();
await harvestTokenNav();

let fromNav = 0;
for (const row of blanks) {
  const text = byHost.get(String(row.domain).toLowerCase());
  if (!text) continue;
  row.description = text;
  fromNav += 1;
}
console.log(JSON.stringify({ fromNav }));
saveJson(verdPath, verd);

const left = blanks.filter((row) => !clean(row.description));
const queue = left.slice();
let done = 0;
let filled = 0;
async function searchOne(row) {
  const queries = [
    `"${row.domain}" site:apisou.com OR site:apizhao.com OR site:ccnavx.com OR site:apitokennav.com OR site:eggstriker.com OR site:betterai.dev`,
    `"${row.domain}" 中转站`,
  ];
  for (const query of queries) {
    const page = await fetchUrl(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, 400000);
    const body = page.body || "";
    const plain = clean(body);
    if (plain.toLowerCase().includes(String(row.domain).toLowerCase())) {
      const around = plain.split(/(?<=[。！？])/).find((part) => part.toLowerCase().includes(String(row.domain).toLowerCase()) && !junk(part, row.name) && !/搜索|百度|知乎|视频号/.test(part));
      if (around) return around.slice(0, 220);
    }
    const links = [];
    const re = /<h2[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"/gi;
    let match;
    while ((match = re.exec(body)) && links.length < 3) {
      if (/bing\.com|microsoft\.com|baidu\.com|zhihu\.com/i.test(match[1])) continue;
      if (match[1].includes(row.domain)) continue;
      links.push(match[1]);
    }
    for (const link of links) {
      const found = await fetchUrl(link, 250000);
      const text = clean(found.body || "");
      if (!text.toLowerCase().includes(String(row.domain).toLowerCase())) continue;
      const part = text.split(/(?<=[。！？])/).find((item) => item.toLowerCase().includes(String(row.domain).toLowerCase()) && !junk(item, row.name));
      if (part) return part.slice(0, 220);
    }
  }
  const guesses = [
    `https://apitokennav.com/sites/${row.domain.replace(/\./g, "-")}/`,
    `https://www.eggstriker.com/ai-api/${String(row.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    `https://ccnavx.com/zh/sites/${String(row.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
  ];
  for (const link of guesses) {
    const found = await fetchUrl(link, 250000);
    if (!found.body || found.status >= 400) continue;
    const text = clean(found.body);
    if (!text.toLowerCase().includes(String(row.domain).toLowerCase()) && !text.toLowerCase().includes(String(row.name || "").toLowerCase())) continue;
    const part = sentence(text, row.name);
    if (part) return part;
  }
  return "";
}
async function worker() {
  while (queue.length) {
    const row = queue.shift();
    let text = "";
    try { text = await searchOne(row); } catch { text = ""; }
    if (text) { row.description = text; filled += 1; }
    done += 1;
    if (done % 20 === 0 || done === left.length) {
      saveJson(verdPath, verd);
      console.log(JSON.stringify({ done, left: left.length - done, filled }));
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()));
const counts = new Map();
for (const row of verd.stations) {
  const text = clean(row.description);
  if (text) counts.set(text, (counts.get(text) || 0) + 1);
}
let cleared = 0;
for (const row of verd.stations) {
  const text = clean(row.description);
  if (text && counts.get(text) >= 5) { row.description = ""; cleared += 1; }
}
saveJson(verdPath, verd);
const blank = verd.stations.filter((row) => !clean(row.description)).length;
console.log(JSON.stringify({ fromNav, filled, cleared, blank }));
saveJson(factPath, { fromNav, filled, cleared, blank });
