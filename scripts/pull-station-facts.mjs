import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const publicPath = resolve(root, "src", "station-public.json");
const factPath = resolve(root, "data", "station-facts.json");
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
mkdirSync(resolve(root, "data"), { recursive: true });

const verd = JSON.parse(readFileSync(verdPath, "utf8"));
const pub = JSON.parse(readFileSync(publicPath, "utf8"));
pub.stations = pub.stations || {};
let facts = {};
try { facts = JSON.parse(readFileSync(factPath, "utf8")); } catch { facts = {}; }
facts.checked = facts.checked || {};

const only = (process.env.FACT_ONLY || "").split(",").map((item) => item.trim()).filter(Boolean);
const FAMILIES = [
  ["gpt", "GPT", /gpt|chatgpt|openai|codex|\bo[134]\b/i],
  ["claude", "Claude", /claude|anthropic|sonnet|opus/i],
  ["gemini", "Gemini", /gemini/i],
  ["grok", "Grok", /\bgrok\b/i],
  ["deepseek", "DeepSeek", /deepseek/i],
  ["kimi", "Kimi", /kimi|moonshot/i],
  ["qwen", "Qwen", /qwen|通义|千问/i],
  ["glm", "GLM", /\bglm\b|智谱|chatglm/i],
  ["image", "生图", /dall-e|flux|imagen|midjourney|gpt-image|stable-diffusion|生图|绘图/i],
  ["video", "视频", /\bsora\b|kling|runway|\bveo\b|视频/i],
];
const PLATFORM = {
  openai: "gpt", anthropic: "claude", claude: "claude", gemini: "gemini", google: "gemini",
  xai: "grok", grok: "grok", deepseek: "deepseek", moonshot: "kimi", kimi: "kimi",
  qwen: "qwen", alibaba: "qwen", zhipu: "glm", glm: "glm",
};

function saveJson(path, data) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
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
    const headers = { Host: target.host, "User-Agent": "Mozilla/5.0", Accept: "text/html,application/json,*/*" };
    const path = encodePath(target) || "/";
    if (!proxy) {
      const lib = target.protocol === "http:" ? http : https;
      let req;
      try {
        req = lib.request({
          host: target.hostname,
          servername: target.protocol === "https:" && !/^[0-9.]+$/.test(target.hostname) ? target.hostname : undefined,
          port: target.port || undefined,
          path,
          method: "GET",
          timeout,
          headers,
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
    if (target.protocol === "http:") {
      const req = http.request({
        host: proxyUrl.hostname, port: proxyUrl.port || 80, method: "GET", path: target.href, timeout, headers,
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
        fail(new Error("proxy " + res.statusCode));
        return;
      }
      let req;
      try {
        req = https.request({
          host: target.hostname,
          servername: /^[0-9.]+$/.test(target.hostname) ? undefined : target.hostname,
          path, method: "GET", socket, agent: false, headers,
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
    connect.end();
  });
}

const proxyHosts = new Set();
async function fetchUrl(targetUrl, limit = 700000) {
  let current = targetUrl;
  let useProxy = false;
  try { useProxy = proxyHosts.has(new URL(targetUrl).host); } catch { /* keep */ }
  for (let hop = 0; hop < 3; hop += 1) {
    let res;
    try {
      res = await requestRaw(current, { timeout: 7000, limit, proxy: useProxy });
    } catch {
      if (useProxy) return { status: 0, body: "", url: current, type: "" };
      useProxy = true;
      try { proxyHosts.add(new URL(current).host); } catch { /* skip */ }
      try { res = await requestRaw(current, { timeout: 8000, limit, proxy: true }); }
      catch { return { status: 0, body: "", url: current, type: "" }; }
    }
    if (!useProxy && (res.status === 403 || res.status === 503 || res.status === 429)) {
      try {
        const via = await requestRaw(current, { timeout: 8000, limit, proxy: true });
        if (via.status >= 200 && via.status < 400) {
          try { proxyHosts.add(new URL(current).host); } catch { /* skip */ }
          res = via;
        }
      } catch { /* keep direct */ }
    }
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return { status: res.status, body: res.body.toString("utf8"), url: current, type: String(res.headers["content-type"] || "") };
  }
  return { status: 310, body: "", url: current, type: "" };
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag, name) {
  const match = tag.match(new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
  return match ? match[2].trim() : "";
}

function pageLinks(html, base) {
  const found = [];
  const tags = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const tag of tags) {
    const href = attr(tag, "href");
    const label = stripHtml(tag);
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    if (!/充值|支付|价格|定价|发票|退款|文档|模型|关于|pricing|price|topup|pay|doc|about|faq|model/i.test(label + " " + href)) continue;
    try {
      const url = new URL(href, base);
      if (url.origin !== new URL(base).origin) continue;
      found.push(url.href);
    } catch { /* skip */ }
  }
  return [...new Set(found)].slice(0, 5);
}

function jsonStrings(text) {
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  const out = [];
  const walk = (value, depth) => {
    if (out.length > 40 || depth > 6 || value == null) return;
    if (typeof value === "string") {
      if (value.length > 8 && value.length < 30000) out.push(value);
      return;
    }
    if (typeof value !== "object") return;
    for (const item of Object.values(value)) walk(item, depth + 1);
  };
  walk(json, 0);
  return out;
}

function modelsFromPricing(text) {
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const seen = new Set();
  const names = [];
  for (const item of data) {
    const name = String(item?.model_name || item?.id || item?.model || "").trim();
    const key = name.toLowerCase();
    if (!name || name.length > 80 || seen.has(key)) continue;
    if (item?.model_name || /^[a-z0-9._:/+-]{2,80}$/i.test(name)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names.slice(0, 500);
}

function modelsFromPlaza(text) {
  let json;
  try { json = JSON.parse(text); } catch { return { names: [], families: [] }; }
  const names = [];
  const families = new Set();
  const seen = new Set();
  const walk = (value, depth) => {
    if (!value || depth > 7) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    const platform = String(value.platform || value.vendor || "").toLowerCase();
    if (PLATFORM[platform]) families.add(PLATFORM[platform]);
    for (const key of ["models", "model_list", "modelList", "items"]) {
      const list = value[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const name = typeof item === "string" ? item : String(item?.model_name || item?.name || item?.id || "");
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 80 || seen.has(trimmed.toLowerCase())) continue;
        if (/分组|套餐|渠道/.test(trimmed)) continue;
        if (FAMILIES.some(([, , re]) => re.test(trimmed))) {
          seen.add(trimmed.toLowerCase());
          names.push(trimmed);
        }
      }
    }
    for (const item of Object.values(value)) {
      if (item && typeof item === "object") walk(item, depth + 1);
    }
  };
  walk(json, 0);
  return { names: names.slice(0, 500), families: [...families] };
}

function familiesFromText(text) {
  const found = [];
  for (const [id, , re] of FAMILIES) {
    if (re.test(text) && !found.includes(id)) found.push(id);
  }
  return found;
}

function payFromText(text) {
  const found = [];
  const add = (key) => { if (!found.includes(key)) found.push(key); };
  if (/支付宝/.test(text)) add("alipay");
  if (/微信支付|微信充值|微信付款|支持微信/.test(text)) add("wechat");
  if (/USDT|USDC|加密货币|加密充值/.test(text)) add("usdt");
  if (/银行卡|信用卡|储蓄卡/.test(text)) add("bank");
  if (/对公/.test(text)) add("corp");
  if (/paypal/i.test(text)) add("paypal");
  if (/淘宝/.test(text)) add("taobao");
  return found;
}

function clauseMark(text, wordRe, noRe, yesRe) {
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

function factsFromText(text) {
  return {
    pay: payFromText(text),
    refund: clauseMark(text, /退款|退费/, /不支持退|不予退|概不退|不可退|无法退|不能退|不退款|不退费|充值不退|售出不退|虚拟商品不退/, /支持退款|可以退款|可退款|允许退款|退款申请/),
    invoice: clauseMark(text, /发票|开票/, /不支持发票|不开发票|无法开票|不能开票|不提供发票|无发票/, /可开发票|支持发票|提供发票|可以开票|可开专票|可开普票|增值税发票|电子发票/),
    families: familiesFromText(text),
  };
}

function mergeFacts(base, extra) {
  for (const key of extra.pay || []) if (!base.pay.includes(key)) base.pay.push(key);
  if (!base.refund && extra.refund) base.refund = extra.refund;
  if (!base.invoice && extra.invoice) base.invoice = extra.invoice;
  for (const id of extra.families || []) if (!base.families.includes(id)) base.families.push(id);
}

function applyRow(row, fact) {
  let changed = false;
  if (fact.pay.length) {
    const next = fact.pay.filter((item) => item !== "国内");
    if (next.length) {
      row.pay = next;
      changed = true;
      if ((row.pay.includes("alipay") || row.pay.includes("wechat") || row.pay.includes("bank") || row.pay.includes("corp")) && !(row.categories || []).includes("pay")) {
        row.categories = [...(row.categories || []), "pay"];
      }
      if (row.pay.includes("usdt") && !(row.categories || []).includes("crypto")) {
        row.categories = [...(row.categories || []), "crypto"];
      }
    }
  }
  if (fact.refund) {
    row.refund = fact.refund;
    changed = true;
  }
  if (fact.invoice === "yes") {
    row.invoice = true;
    changed = true;
    if (!(row.categories || []).includes("invoice")) row.categories = [...(row.categories || []), "invoice"];
  } else if (fact.invoice === "no") {
    row.invoice = "no";
    changed = true;
  }
  const published = pub.stations[String(row.id)];
  const hasModels = (published?.models || []).length > 0 || (row.modelCount || 0) > 0 || (row.modelIds || []).length > 0;
  if (fact.models.length && !(published?.models || []).length) {
    const families = familiesFromText(fact.models.join(" "));
    row.modelIds = families;
    row.modelCount = fact.models.length;
    row.modelLabels = families.map((id) => FAMILIES.find((item) => item[0] === id)?.[1] || id).join("、");
    row.modelRows = families.map((id) => ({ id, name: FAMILIES.find((item) => item[0] === id)?.[1] || id, group: "公开", ratio: null }));
    pub.stations[String(row.id)] = {
      ...(published || {}),
      models: fact.models.slice(0, 400).map((name) => ({ id: name, name, group: "公开", ratio: null })),
    };
    changed = true;
  } else if (!hasModels && fact.families.length) {
    row.modelIds = fact.families;
    row.modelCount = fact.families.length;
    row.modelLabels = fact.families.map((id) => FAMILIES.find((item) => item[0] === id)?.[1] || id).join("、");
    row.modelRows = fact.families.map((id) => ({ id, name: FAMILIES.find((item) => item[0] === id)?.[1] || id, group: "公开", ratio: null }));
    changed = true;
  }
  if (changed) {
    for (const item of verd.attach || []) {
      if (item.token !== row.token) continue;
      if ((row.pay || []).length) item.pay = row.pay;
      if (row.invoice === true) item.invoice = true;
    }
  }
  return changed;
}

const API_PATHS = ["/api/pricing", "/api/status", "/api/about", "/api/notice", "/api/home_page_content", "/api/v1/model-plaza", "/v1/models"];

async function one(row) {
  let origin = "";
  try { origin = new URL(row.url).origin; } catch { return null; }
  const page = await fetchUrl(row.url, 500000);
  const html = page.status >= 200 && page.status < 400 ? page.body : "";
  const finalUrl = page.url || row.url;
  let base = origin;
  try { base = new URL(finalUrl).origin; } catch { /* keep */ }
  const apiResults = await Promise.all(API_PATHS.map((path) => fetchUrl(base + path, 900000).catch(() => ({ status: 0, body: "", type: "" }))));
  const texts = [];
  const visible = stripHtml(html);
  if (visible.length > 40) texts.push(visible);
  let models = [];
  const families = new Set();
  apiResults.forEach((res, index) => {
    if (!res || res.status < 200 || res.status >= 400) return;
    const path = API_PATHS[index];
    if (path === "/api/pricing" || path === "/v1/models") {
      const names = modelsFromPricing(res.body);
      if (names.length > models.length) models = names;
    } else if (path === "/api/v1/model-plaza") {
      const plaza = modelsFromPlaza(res.body);
      if (plaza.names.length > models.length) models = plaza.names;
      plaza.families.forEach((id) => families.add(id));
    }
    if (/json/i.test(res.type) || res.body.trim().startsWith("{") || res.body.trim().startsWith("[")) {
      texts.push(...jsonStrings(res.body).map(stripHtml));
    }
  });
  const links = html ? pageLinks(html, finalUrl) : [];
  const extraPages = await Promise.all(links.map((url) => fetchUrl(url, 400000).catch(() => null)));
  for (const extra of extraPages) {
    if (!extra || extra.status < 200 || extra.status >= 400) continue;
    const text = stripHtml(extra.body);
    if (text.length > 40) texts.push(text);
  }
  let statusJson = null;
  try { statusJson = JSON.parse(apiResults[1]?.body || ""); } catch { /* none */ }
  const docs = statusJson?.data?.docs_link || statusJson?.data?.top_up_link || "";
  if (/^https?:\/\//i.test(docs)) {
    const docPage = await fetchUrl(docs, 300000).catch(() => null);
    if (docPage && docPage.status >= 200 && docPage.status < 400) {
      const text = stripHtml(docPage.body);
      if (text.length > 40) texts.push(text);
    }
  }
  const joined = texts.join("\n").slice(0, 200000);
  const fact = factsFromText(joined);
  fact.models = models;
  for (const id of families) if (!fact.families.includes(id)) fact.families.push(id);
  if ((!fact.pay.length || !fact.refund || !fact.invoice) && html && visible.length < 500) {
    const src = (html.match(/<script[^>]+src=["']([^"']+\.js)["']/i) || [])[1];
    if (src && !/cloudflare|gtag|analytics/i.test(src)) {
      try {
        const scriptUrl = new URL(src, finalUrl).href;
        const js = await fetchUrl(scriptUrl, 900000);
        const paths = [...js.body.matchAll(/["'](\/(?:api|api\/v1)\/(?!admin)[a-z0-9_./-]{2,70})["']/gi)]
          .map((match) => match[1])
          .filter((path) => /pric|model|pay|about|notice|plaza|billing/i.test(path));
        const fresh = [...new Set(paths)].filter((path) => !API_PATHS.includes(path)).slice(0, 4);
        for (const path of fresh) {
          const res = await fetchUrl(base + path, 700000).catch(() => null);
          if (!res || res.status < 200 || res.status >= 400) continue;
          const names = modelsFromPricing(res.body);
          const plaza = modelsFromPlaza(res.body);
          if (names.length > fact.models.length) fact.models = names;
          if (plaza.names.length > fact.models.length) fact.models = plaza.names;
          plaza.families.forEach((id) => { if (!fact.families.includes(id)) fact.families.push(id); });
          mergeFacts(fact, factsFromText(jsonStrings(res.body).join("\n")));
        }
      } catch { /* no extra api */ }
    }
  }
  return fact;
}

let jobs = (verd.stations || []).filter((row) => /^https?:\/\//i.test(row.url || ""));
if (!process.env.FACT_FORCE) jobs = jobs.filter((row) => !facts.checked[row.token]);
if (only.length) jobs = jobs.filter((row) => only.some((host) => String(row.url || "").includes(host) || String(row.domain || "").includes(host)));
console.log(JSON.stringify({ todo: jobs.length, already: Object.keys(facts.checked).length }));

const queue = jobs.slice();
let done = 0;
let payN = 0;
let refundN = 0;
let invoiceN = 0;
let modelN = 0;

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    let fact = null;
    try { fact = await one(row); } catch { fact = null; }
    const record = fact || { pay: [], refund: "", invoice: "", families: [], models: [] };
    facts.checked[row.token] = {
      pay: record.pay,
      refund: record.refund,
      invoice: record.invoice,
      models: record.models.length,
      families: record.families,
    };
    if (fact) {
      applyRow(row, fact);
      if (fact.pay.length) payN += 1;
      if (fact.refund) refundN += 1;
      if (fact.invoice) invoiceN += 1;
      if (fact.models.length || fact.families.length) modelN += 1;
    }
    done += 1;
    if (done % 20 === 0 || done === jobs.length) {
      saveJson(verdPath, verd);
      saveJson(publicPath, pub);
      saveJson(factPath, facts);
      console.log(JSON.stringify({ done, left: jobs.length - done, pay: payN, refund: refundN, invoice: invoiceN, models: modelN }));
    }
  }
}

await Promise.all(Array.from({ length: 8 }, () => worker()));
saveJson(verdPath, verd);
saveJson(publicPath, pub);
saveJson(factPath, facts);
console.log(JSON.stringify({ done, pay: payN, refund: refundN, invoice: invoiceN, models: modelN, checked: Object.keys(facts.checked).length }));
