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
  try {
    const res = await requestRaw(url, false);
    if (res.status >= 200 && res.status < 400 && !/Attention Required|you have been blocked/i.test(res.body)) return res.body;
  } catch { /* proxy */ }
  try {
    const res = await requestRaw(url, true);
    return res.status >= 200 && res.status < 400 ? res.body : "";
  } catch { return ""; }
}
function parseProbe(html) {
  const plain = clean(html);
  const how = plain.match(/累计\s*(\d+)\s*次独立检测,\s*中位分\s*(\d+)\/100\s*,\s*判定\s*「([^」]+)」/);
  if (!how || Number(how[1]) === 0) return null;
  const protocols = ((plain.match(/覆盖协议:\s*([^。]+)。/) || [])[1] || "").split(/[·,，]/).map((item) => item.trim()).filter(Boolean);
  const last = (plain.match(/最近一次检测:(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
  const days = plain.match(/近 90 天检测\s*(\d+)\s*天/);
  const endpoint = (plain.match(/实际检测 endpoint:\s*([a-z0-9.-]+)/i) || [])[1] || "";
  const grade = (plain.match(/综合可信度\s*([A-D][+-]?)/) || [])[1] || "";
  const trend = (plain.match(/趋势\(Δ\s*([+-]?[0-9.]+)\)/) || [])[1] || "";
  const consistency = (plain.match(/(\d+(?:\.\d+)?)%\s*verdict 一致性/) || [])[1] || "";
  const serious = plain.match(/(\d+)\s*\/\s*(\d+)\s*全站严重问题报告/);
  const officialMatch = plain.match(/官方信息\s+(.{20,300}?)(?:自动测评|综合可信度|想自己测|这页数据怎么来)/);
  const official = officialMatch && !/尚未收录|酷站AI|赞助/.test(officialMatch[1]) ? officialMatch[1].trim().slice(0, 240) : "";
  return {
    checks: Number(how[1]),
    median: Number(how[2]),
    verdict: how[3],
    protocols,
    last,
    days90: days ? Number(days[1]) : null,
    endpoint,
    grade,
    trend,
    consistency,
    serious: serious ? Number(serious[1]) : null,
    seriousTotal: serious ? Number(serious[2]) : null,
    official,
  };
}

const jobs = (verd.stations || []).filter((row) => row.domain && !row.probe);
console.log(JSON.stringify({ todo: jobs.length }));
const queue = jobs.slice();
let done = 0;
let filled = 0;
async function worker() {
  while (queue.length) {
    const row = queue.shift();
    const html = await fetchUrl(`https://veridrop.org/leaderboard/${encodeURIComponent(row.domain)}`);
    const probe = parseProbe(html);
    if (probe) { row.probe = probe; filled += 1; }
    done += 1;
    if (done % 25 === 0 || done === jobs.length) {
      saveJson(verdPath, verd);
      console.log(JSON.stringify({ done, left: jobs.length - done, filled }));
    }
  }
}
await Promise.all(Array.from({ length: 5 }, () => worker()));
saveJson(verdPath, verd);
console.log(JSON.stringify({ done, filled }));
