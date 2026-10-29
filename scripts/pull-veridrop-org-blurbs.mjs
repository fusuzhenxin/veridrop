import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
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
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function requestRaw(targetUrl, proxy) {
  const target = new URL(targetUrl);
  return new Promise((resolvePromise, reject) => {
    const fail = (error) => reject(error instanceof Error ? error : new Error(String(error || "error")));
    const timer = setTimeout(() => fail(new Error("timeout")), proxy ? 12000 : 9000);
    const finish = (status, chunks) => { clearTimeout(timer); resolvePromise({ status, body: Buffer.concat(chunks).toString("utf8") }); };
    const collect = (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > 450000) { res.destroy(); finish(res.statusCode || 0, chunks); return; } chunks.push(chunk); });
      res.on("end", () => finish(res.statusCode || 0, chunks));
    };
    const headers = { Host: target.host, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", Accept: "text/html", "Accept-Language": "zh-CN,zh;q=0.9" };
    const path = target.pathname + target.search;
    if (!proxy) {
      const req = https.request({ host: target.hostname, servername: target.hostname, path, method: "GET", headers }, collect);
      req.on("error", fail); req.end(); return;
    }
    const connect = http.request({ host: proxyUrl.hostname, port: proxyUrl.port || 80, method: "CONNECT", path: `${target.hostname}:443` });
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); fail(new Error("proxy")); return; }
      const req = https.request({ host: target.hostname, servername: target.hostname, path, method: "GET", socket, agent: false, headers }, collect);
      req.on("error", fail); req.end();
    });
    connect.on("error", fail); connect.end();
  });
}
async function fetchUrl(url) {
  try { const res = await requestRaw(url, false); if (res.status >= 200 && res.status < 400 && !/Attention Required|cf-error/i.test(res.body)) return res.body; } catch { /* proxy */ }
  try { const res = await requestRaw(url, true); return res.status >= 200 && res.status < 400 ? res.body : ""; } catch { return ""; }
}
function blurbFrom(html) {
  const plain = clean(html);
  if (!plain || /Attention Required|you have been blocked/i.test(plain)) return "";
  const official = plain.match(/官方信息\s+(.{20,360}?)(?:自动测评|综合可信度|想自己测|这页数据怎么来)/);
  if (official && !/尚未收录|酷站AI|赞助/.test(official[1])) return official[1].slice(0, 220);
  const how = plain.match(/中转站怎么样\?\s*(.{20,220}?)(?:已收录站点推荐|想自己测|这页数据怎么来|当前域名尚未收录)/);
  if (how && !/累计\s*0\s*次/.test(how[1])) return how[1].slice(0, 220);
  return "";
}

const jobs = (verd.stations || []).filter((row) => !clean(row.description) && row.domain);
console.log(JSON.stringify({ todo: jobs.length }));
const queue = jobs.slice();
let done = 0;
let filled = 0;
async function worker() {
  while (queue.length) {
    const row = queue.shift();
    const html = await fetchUrl(`https://veridrop.org/leaderboard/${encodeURIComponent(row.domain)}`);
    const text = blurbFrom(html);
    if (text) { row.description = text; filled += 1; }
    done += 1;
    if (done % 25 === 0 || done === jobs.length) {
      saveJson(verdPath, verd);
      console.log(JSON.stringify({ done, left: jobs.length - done, filled }));
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()));
saveJson(verdPath, verd);
const blank = verd.stations.filter((row) => !clean(row.description)).length;
console.log(JSON.stringify({ done, filled, blank }));
