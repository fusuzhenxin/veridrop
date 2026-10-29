import http from "node:http";
import https from "node:https";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../src/relay-live.json");

function via(url) {
  const target = new URL(url);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(""), 20000);
    const connect = http.request({ host: "127.0.0.1", port: 7897, method: "CONNECT", path: `${target.hostname}:443` });
    connect.on("connect", (res, socket) => {
      const req = https.request({
        host: target.hostname, servername: target.hostname, path: target.pathname + target.search, method: "GET", socket, agent: false,
        headers: { Host: target.host, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", Accept: "text/html", "Accept-Language": "zh-CN" },
      }, (page) => {
        const chunks = [];
        page.on("data", (c) => chunks.push(c));
        page.on("end", () => { clearTimeout(timer); resolvePromise(Buffer.concat(chunks).toString("utf8")); });
      });
      req.end();
    });
    connect.on("error", () => { clearTimeout(timer); resolvePromise(""); });
    connect.end();
  });
}

function decode(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function secondsOf(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return /ms/i.test(match[2]) ? value / 1000 : value;
}

function cellsOf(chunk) {
  return [...chunk.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map((match) => ({
    cls: (match[1].match(/class="([^"]*)"/) || [])[1] || "",
    raw: match[2],
    text: decode(match[2]),
  }));
}

function rowMetrics(chunk) {
  const cells = cellsOf(chunk);
  const promoCell = cells.find((cell) => cell.cls.includes("operator-promotion-cell"));
  let promo = "";
  if (promoCell && !/非自动探测/.test(promoCell.raw)) {
    promo = decode((promoCell.raw.match(/title="([^"]*)"/) || [])[1] || promoCell.text).slice(0, 80);
    if (/不是首 Token 延迟|近 7 日最小真实请求/.test(promo)) promo = "";
  }
  const promoAt = cells.indexOf(promoCell);
  const after = promoAt >= 0 ? cells.slice(promoAt + 1) : cells;
  const uptimeCell = after.find((cell) => /(\d+(?:\.\d+)?)%/.test(cell.text) && !/非自动探测/.test(cell.raw));
  const latencyCell = after.find((cell) => {
    if (/非自动探测/.test(cell.raw)) return false;
    if (/P50/.test(cell.raw)) return secondsOf(cell.text) != null;
    return cell.cls.includes("operator-latency-cell") && secondsOf(cell.text) != null;
  });
  const uptime = uptimeCell ? Number(uptimeCell.text.match(/(\d+(?:\.\d+)?)%/)[1]) : null;
  const latency = latencyCell ? Math.round(secondsOf(latencyCell.text) * 10) / 10 : null;
  const probed = cells.some((cell) => cell.cls.includes("operator-probe-time-cell") && cell.text);
  const tier = latency != null && probed ? 2 : latency != null ? 1 : uptime != null ? 0 : -1;
  return { uptime, latency, promo, tier };
}

const html = await via("https://veridrop.org/");
const book = {};
for (const chunk of html.split(/<tr[\s>]/).slice(1)) {
  const domain = (chunk.match(/data-impression-domain="([^"]+)"/) || [])[1];
  if (!domain) continue;
  const next = rowMetrics(chunk);
  const current = book[domain] || { uptime: null, latency: null, promo: "", tier: -1 };
  if (next.tier >= current.tier && next.tier >= 0) {
    current.uptime = next.uptime;
    current.latency = next.latency;
    current.tier = next.tier;
  }
  if (next.promo && next.promo.length > current.promo.length) current.promo = next.promo;
  book[domain] = current;
}
for (const row of Object.values(book)) delete row.tier;
writeFileSync(out, JSON.stringify(book));
console.log(JSON.stringify({ rows: Object.keys(book).length, sample: book["jizhiapi.site"] || book["shushutoken.com"] || null }));
