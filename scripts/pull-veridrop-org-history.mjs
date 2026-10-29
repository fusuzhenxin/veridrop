import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const testsPath = resolve(root, "src", "external-tests.json");
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
const verd = JSON.parse(readFileSync(verdPath, "utf8"));
let tests = {};
try { tests = JSON.parse(readFileSync(testsPath, "utf8")); } catch { tests = {}; }

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
      res.on("data", (chunk) => { size += chunk.length; if (size > 500000) { res.destroy(); finish(res.statusCode || 0, chunks); return; } chunks.push(chunk); });
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
function historyRows(html) {
  const rows = [];
  const re = /<tr>\s*<td>(\d{4}-\d{2}-\d{2})<\/td>\s*<td>([^<]+)<\/td>\s*<td><code>([^<]*)<\/code><\/td>[\s\S]*?lb-history-score[^>]*>\s*(\d+)\s*<\/span>[\s\S]*?<a href="(\/r\/[^"]+)"/gi;
  let match;
  while ((match = re.exec(html)) && rows.length < 30) {
    rows.push({
      at: `${match[1]}T00:00:00+08:00`,
      channel: clean(match[2]),
      model: clean(match[3]),
      score: Number(match[4]),
    });
  }
  return rows;
}
function minFrom(text) {
  const nums = [];
  const re = /最低(?:充值|门槛)([^。\n]{0,24})|[¥￥]\s*(\d+(?:\.\d+)?)\s*起充|(\d+(?:\.\d+)?)\s*元起充/g;
  let match;
  while ((match = re.exec(text))) {
    if (match[2] || match[3]) nums.push(Number(match[2] || match[3]));
    else {
      const yuan = String(match[1] || "").match(/[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元/);
      if (yuan) nums.push(Number(yuan[1] || yuan[2]));
    }
  }
  const amounts = nums.filter((value) => value >= 1 && value <= 10000);
  return amounts.length ? `¥${Math.min(...amounts)}` : "";
}
function payFrom(text) {
  const found = [];
  const add = (key) => { if (!found.includes(key)) found.push(key); };
  if (/支付宝/.test(text)) add("alipay");
  if (/微信支付|微信充值|微信付款/.test(text)) add("wechat");
  if (/USDT|USDC/.test(text)) add("usdt");
  if (/银行卡|信用卡|visa|mastercard/i.test(text)) add("bank");
  if (/对公/.test(text)) add("corp");
  return found;
}
function applyBlanks(row, text) {
  if (!text) return;
  if (!row.minTopup) {
    const min = minFrom(text);
    if (min) row.minTopup = min;
  }
  if (!(row.pay || []).length) {
    const pay = payFrom(text);
    if (pay.length) row.pay = pay;
  }
  if (row.invoice !== true && row.invoice !== "no") {
    if (/不支持发票|不开发票|无法开票/.test(text)) row.invoice = "no";
    else if (/可开发票|支持发票|提供发票|可开票/.test(text)) row.invoice = true;
  }
  if (row.refund !== "yes" && row.refund !== "no") {
    if (/不支持退|不予退|不可退|不退款/.test(text)) row.refund = "no";
    else if (/支持退款|可以退款|可退款/.test(text)) row.refund = "yes";
  }
  if (!row.promo) {
    const promo = text.match(/新用户[^。]{0,24}|注册送[^。]{0,20}|首充[^。]{0,24}/);
    if (promo) row.promo = promo[0].trim().slice(0, 40);
  }
}

const jobs = (verd.stations || []).filter((row) => row.domain && !tests[row.domain]);
jobs.sort((a, b) => Number(b.domain === "code28.ccwu.cc") - Number(a.domain === "code28.ccwu.cc"));
console.log(JSON.stringify({ todo: jobs.length }));
const queue = jobs.slice();
let done = 0;
let filled = 0;
async function worker() {
  while (queue.length) {
    const row = queue.shift();
    const html = await fetchUrl(`https://veridrop.org/leaderboard/${encodeURIComponent(row.domain)}`);
    const rows = historyRows(html);
    if (rows.length) {
      tests[row.domain] = rows;
      filled += 1;
    } else if (html.length > 800 && !/Attention Required|you have been blocked/i.test(html)) {
      tests[row.domain] = [];
    }
    const plain = clean(html);
    const official = (plain.match(/官方信息\s+(.{0,500}?)(?:自动测评|综合可信度|想自己测|这页数据怎么来)/) || [])[1] || "";
    applyBlanks(row, official);
    done += 1;
    if (done % 20 === 0 || done === jobs.length) {
      saveJson(testsPath, tests);
      saveJson(verdPath, verd);
      console.log(JSON.stringify({ done, left: jobs.length - done, filled }));
    }
  }
}
await Promise.all(Array.from({ length: 5 }, () => worker()));
saveJson(testsPath, tests);
saveJson(verdPath, verd);
console.log(JSON.stringify({ done, filled, withTests: Object.keys(tests).length }));
