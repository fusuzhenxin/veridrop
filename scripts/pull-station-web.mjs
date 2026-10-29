import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const publicPath = resolve(root, "src", "station-public.json");
const factPath = resolve(root, "data", "station-web.json");
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
mkdirSync(resolve(root, "data"), { recursive: true });

const verd = JSON.parse(readFileSync(verdPath, "utf8"));
const pub = JSON.parse(readFileSync(publicPath, "utf8"));
pub.stations = pub.stations || {};
let saved = {};
try { saved = JSON.parse(readFileSync(factPath, "utf8")); } catch { saved = {}; }
saved.checked = saved.checked || {};

const only = (process.env.WEB_ONLY || "").split(",").map((item) => item.trim()).filter(Boolean);
const FAMILIES = [
  ["gpt", "GPT", /gpt|chatgpt|openai|codex|\bo[134]\b/i],
  ["claude", "Claude", /claude|anthropic|sonnet|opus/i],
  ["gemini", "Gemini", /gemini/i],
  ["grok", "Grok", /\bgrok\b/i],
  ["deepseek", "DeepSeek", /deepseek/i],
  ["kimi", "Kimi", /kimi|moonshot/i],
  ["qwen", "Qwen", /qwen|通义|千问/i],
  ["glm", "GLM", /\bglm\b|智谱|chatglm/i],
];

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* wait for the preview to release the file */ }
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

function encodePath(target) {
  try {
    return target.pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/") + target.search;
  } catch {
    return target.pathname + target.search;
  }
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
    const path = encodePath(target) || "/";
    if (!proxy) {
      const lib = target.protocol === "http:" ? http : https;
      let req;
      try {
        req = lib.request({
          host: target.hostname,
          servername: target.protocol === "https:" && !/^[0-9.]+$/.test(target.hostname) ? target.hostname : undefined,
          port: target.port || undefined,
          path, method: "GET", timeout, headers,
        }, collect);
      } catch (error) {
        clearTimeout(timer);
        fail(error);
        return;
      }
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
async function fetchUrl(targetUrl, limit = 500000) {
  let current = targetUrl;
  let useProxy = false;
  try { useProxy = proxyHosts.has(new URL(current).host); } catch { /* keep */ }
  for (let hop = 0; hop < 3; hop += 1) {
    let res;
    try {
      res = await requestRaw(current, { timeout: 8000, limit, proxy: useProxy });
    } catch {
      if (useProxy) return { status: 0, body: "", url: current };
      useProxy = true;
      try { proxyHosts.add(new URL(current).host); } catch { /* skip */ }
      try { res = await requestRaw(current, { timeout: 9000, limit, proxy: true }); }
      catch { return { status: 0, body: "", url: current }; }
    }
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return { status: res.status, body: res.body.toString("utf8"), url: current };
  }
  return { status: 310, body: "", url: current };
}

function strip(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyFact() {
  return { min: "", pay: [], refund: "", invoice: "", promo: "", families: [], models: [], sources: [] };
}

function mergeFact(base, extra) {
  if (!base.min && extra.min) base.min = extra.min;
  for (const key of extra.pay || []) if (!base.pay.includes(key)) base.pay.push(key);
  if (!base.refund && extra.refund) base.refund = extra.refund;
  if (!base.invoice && extra.invoice) base.invoice = extra.invoice;
  if (!base.promo && extra.promo) base.promo = extra.promo;
  for (const id of extra.families || []) if (!base.families.includes(id)) base.families.push(id);
  if (extra.models?.length > base.models.length) base.models = extra.models;
  if (extra.source) base.sources.push(extra.source);
}

function payFrom(text) {
  const found = [];
  const add = (key) => { if (!found.includes(key)) found.push(key); };
  if (/支付宝/.test(text)) add("alipay");
  if (/微信支付|微信充值|微信付款|支持微信/.test(text)) add("wechat");
  if (/USDT|USDC|加密货币/.test(text)) add("usdt");
  if (/银行卡|信用卡/.test(text)) add("bank");
  if (/对公/.test(text)) add("corp");
  if (/paypal/i.test(text)) add("paypal");
  if (/visa|mastercard|american express/i.test(text)) add("bank");
  if (/淘宝/.test(text)) add("taobao");
  return found;
}

function clause(text, wordRe, noRe, yesRe) {
  let yes = false;
  let no = false;
  for (const part of text.split(/[。！？\n；;]/)) {
    if (!wordRe.test(part)) continue;
    if (noRe.test(part)) no = true;
    else if (yesRe.test(part)) yes = true;
  }
  if (yes === no) return "";
  return yes ? "yes" : "no";
}

function minFrom(text) {
  const nums = [];
  const re = /最低(?:充值|门槛)([^。\n]{0,24})|[¥￥]\s*(\d+(?:\.\d+)?)\s*起充|(\d+(?:\.\d+)?)\s*元起充/g;
  let match;
  while ((match = re.exec(text))) {
    if (match[2] || match[3]) {
      nums.push(Number(match[2] || match[3]));
      continue;
    }
    const yuan = String(match[1] || "").match(/[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元/);
    if (yuan) nums.push(Number(yuan[1] || yuan[2]));
  }
  const amounts = nums.filter((value) => value >= 1 && value <= 10000);
  if (!amounts.length) return "";
  return `¥${Math.min(...amounts)}`;
}

function promoFrom(text) {
  const match = text.match(/新用户[^。；]{0,28}|注册送[^。；]{0,20}|首充[^。；]{0,20}|新人[^。；]{0,20}(?:专享|特价|赠送)/);
  return match ? match[0].trim().slice(0, 40) : "";
}

function familiesFrom(text) {
  return FAMILIES.filter(([, , re]) => re.test(text)).map(([id]) => id);
}

function readText(text, source) {
  const plain = strip(text);
  return {
    min: minFrom(plain),
    pay: payFrom(plain),
    refund: clause(plain, /退款|退费/, /不支持退|不予退|概不退|不可退|无法退|不能退|不退款|充值不退/, /支持退款|可以退款|可退款|允许退款/),
    invoice: clause(plain, /发票|开票/, /不支持发票|不开发票|无法开票|不能开票|不提供发票/, /可开发票|支持发票|提供发票|可以开票|开发票入口/),
    promo: promoFrom(plain),
    families: familiesFrom(plain),
    models: [],
    source,
  };
}

function modelsFromPricing(body) {
  let json;
  try { json = JSON.parse(body); } catch { return []; }
  const data = Array.isArray(json?.data) ? json.data : [];
  const seen = new Set();
  const names = [];
  for (const item of data) {
    const name = String(item?.model_name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names.slice(0, 400);
}

function mentions(text, row) {
  const host = String(row.domain || "").toLowerCase();
  const name = String(row.name || "").toLowerCase();
  const plain = text.toLowerCase();
  return (host && plain.includes(host)) || (name && name.length >= 3 && plain.includes(name));
}

async function searchLinks(query) {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`;
  const page = await fetchUrl(url, 500000);
  const links = [];
  const re = /<h2[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"/gi;
  let match;
  while ((match = re.exec(page.body || "")) && links.length < 8) {
    try {
      const next = new URL(match[1]);
      if (/bing\.com|microsoft\.com|baidu\.com|zhihu\.com/i.test(next.host)) continue;
      links.push(next.href);
    } catch { /* skip */ }
  }
  return links;
}

function doneEnough(fact, row) {
  const needMin = !row.minTopup;
  const needPay = !(row.pay || []).length;
  const needModels = !(row.modelCount > 0) && !(row.modelIds || []).length;
  if (needMin && !fact.min) return false;
  if (needPay && !fact.pay.length) return false;
  if (needModels && !fact.models.length && !fact.families.length) return false;
  return true;
}

async function one(row) {
  const fact = emptyFact();
  let origin = "";
  try { origin = new URL(row.url).origin; } catch { return fact; }
  const ownPaths = ["/", "/api/status", "/api/about", "/api/notice", "/api/pricing", "/api/home_page_content"];
  const pages = await Promise.all(ownPaths.map((path) => fetchUrl(origin + path).catch(() => null)));
  pages.forEach((page, index) => {
    if (!page || page.status < 200 || page.status >= 400 || !page.body) return;
    if (ownPaths[index] === "/api/pricing") {
      const names = modelsFromPricing(page.body);
      if (names.length) fact.models = names;
    }
    mergeFact(fact, readText(page.body, page.url));
    if (ownPaths[index] === "/api/status") {
      try {
        const data = JSON.parse(page.body).data || {};
        for (const key of ["docs_link", "top_up_link", "status_page_url", "announcement_url"]) {
          if (/^https?:\/\//i.test(data[key] || "")) fact.sources.push(String(data[key]));
        }
      } catch { /* not json */ }
    }
  });
  const homeHtml = pages[0]?.body || "";
  const chunks = [...homeHtml.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js[^"]*)"/g)].map((match) => match[1]).slice(0, 2);
  for (const src of chunks) {
    if (fact.min && fact.pay.length) break;
    const js = await fetchUrl(origin + src, 900000).catch(() => null);
    const text = String(js?.body || "").replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (!/最低充值|元起充|支付宝|微信支付/.test(text)) continue;
    mergeFact(fact, readText(text, origin + src));
  }
  const extraLinks = [...new Set(fact.sources.filter((item) => /^https?:\/\//.test(item)))].slice(0, 2);
  for (const link of extraLinks) {
    const page = await fetchUrl(link, 300000).catch(() => null);
    if (page && page.status >= 200 && page.status < 400) mergeFact(fact, readText(page.body, page.url));
  }
  if (!doneEnough(fact, row)) {
    const nameSlug = String(row.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const hostSlug = String(row.domain || "").toLowerCase().replace(/\./g, "-");
    const links = [
      nameSlug ? `https://ccnavx.com/zh/sites/${nameSlug}` : "",
      hostSlug ? `https://apitokennav.com/sites/${hostSlug}/` : "",
    ].filter(Boolean);
    const searched = await searchLinks(`${row.domain || ""} ${row.name || ""} 最低充值 支付宝 发票`).catch(() => []);
    for (const link of searched) if (!links.includes(link)) links.push(link);
    if (!fact.min || !fact.pay.length) {
      const more = await searchLinks(`${row.name || row.domain || ""} 中转站 最低充值 微信支付`).catch(() => []);
      for (const link of more) if (!links.includes(link)) links.push(link);
    }
    const outside = links.filter((link) => !row.domain || !link.includes(row.domain));
    const inside = links.filter((link) => row.domain && link.includes(row.domain));
    for (const link of [...outside, ...inside].slice(0, 6)) {
      if (fact.min && fact.pay.length) break;
      const page = await fetchUrl(link, 300000).catch(() => null);
      if (!page || page.status < 200 || page.status >= 400) continue;
      if (!mentions(strip(page.body), row)) continue;
      mergeFact(fact, readText(page.body, page.url));
    }
  }
  return fact;
}

function apply(row, fact) {
  if (fact.min && !row.minTopup) row.minTopup = fact.min;
  if (fact.pay.length && !(row.pay || []).length) row.pay = fact.pay;
  if (fact.refund && !row.refund) row.refund = fact.refund;
  if (fact.invoice === "yes" && row.invoice !== true) row.invoice = true;
  if (fact.invoice === "no" && row.invoice !== true && row.invoice !== "no") row.invoice = "no";
  if (fact.promo && !row.promo) row.promo = fact.promo;
  const published = pub.stations[String(row.id)];
  if (fact.models.length && !(published?.models || []).length) {
    const families = familiesFrom(fact.models.join(" "));
    row.modelIds = families;
    row.modelCount = fact.models.length;
    row.modelLabels = families.map((id) => FAMILIES.find((item) => item[0] === id)?.[1] || id).join("、");
    pub.stations[String(row.id)] = {
      ...(published || {}),
      models: fact.models.slice(0, 400).map((name) => ({ id: name, name, group: "公开", ratio: null })),
    };
  } else if (fact.families.length && !(row.modelIds || []).length && !(row.modelCount > 0)) {
    row.modelIds = fact.families;
    row.modelCount = fact.families.length;
    row.modelLabels = fact.families.map((id) => FAMILIES.find((item) => item[0] === id)?.[1] || id).join("、");
  }
}

function needs(row) {
  return !row.minTopup || !(row.pay || []).length || (!(row.modelCount > 0) && !(row.modelIds || []).length);
}

let jobs = (verd.stations || []).filter((row) => /^https?:\/\//i.test(row.url || "") && needs(row));
if (!only.length) jobs = jobs.filter((row) => !saved.checked[row.token]);
if (only.length) jobs = jobs.filter((row) => only.some((host) => String(row.url || "").includes(host) || String(row.domain || "").includes(host)));
jobs.sort((a, b) => (b.uptime || 0) - (a.uptime || 0));
console.log(JSON.stringify({ todo: jobs.length }));

const queue = jobs.slice();
let done = 0;
let filled = 0;

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    let fact = emptyFact();
    try { fact = await one(row); } catch { /* keep empty */ }
    apply(row, fact);
    const hit = Boolean(fact.min || fact.pay.length || fact.refund || fact.invoice || fact.promo || fact.models.length || fact.families.length);
    if (hit) filled += 1;
    saved.checked[row.token] = { min: fact.min, pay: fact.pay, refund: fact.refund, invoice: fact.invoice, promo: fact.promo, models: fact.models.length, families: fact.families, sources: fact.sources.slice(0, 6) };
    done += 1;
    if (done % 8 === 0 || done === jobs.length) {
      saveJson(verdPath, verd);
      saveJson(publicPath, pub);
      saveJson(factPath, saved);
      console.log(JSON.stringify({ done, left: jobs.length - done, filled }));
    }
  }
}

await Promise.all(Array.from({ length: 4 }, () => worker()));
saveJson(verdPath, verd);
saveJson(publicPath, pub);
saveJson(factPath, saved);
console.log(JSON.stringify({ done, filled, checked: Object.keys(saved.checked).length }));
