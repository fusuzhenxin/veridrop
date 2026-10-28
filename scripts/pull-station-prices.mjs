import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "src", "station-public.json");
const verd = JSON.parse(readFileSync(resolve(root, "src", "verd-index.json"), "utf8"));

function originOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const byOrigin = new Map();
for (const row of verd.stations || []) {
  const origin = originOf(row.url);
  if (!origin || row.id == null) continue;
  const bucket = byOrigin.get(origin) || { origin, host: hostOf(row.url), ids: [] };
  bucket.ids.push(String(row.id));
  byOrigin.set(origin, bucket);
}

async function getText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { Accept: "application/json", "User-Agent": "VeriDropCatalog/1.0" },
    });
    const text = await res.text();
    return { status: res.status, host: hostOf(res.url), text: text.slice(0, 1_500_000) };
  } catch (err) {
    return { status: 0, host: "", text: "", error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function roundMoney(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100000) return null;
  return Math.round(value * 1e6) / 1e6;
}

function yuanPerRatio(status) {
  const per = Number(status?.quota_per_unit);
  if (!(per > 0)) return null;
  const type = String(status.quota_display_type || "USD").toUpperCase();
  const usdRate = Number(status.usd_exchange_rate);
  const customRate = Number(status.custom_currency_exchange_rate);
  const symbol = String(status.custom_currency_symbol || "");
  const usd = 1e6 / per;
  if (type === "CNY" || type === "RMB") return { factor: usd * (usdRate > 0 ? usdRate : 1), currency: "CNY" };
  if (type === "CUSTOM" && /¥|￥|元|CNY|RMB/i.test(symbol)) {
    const rate = customRate > 0 ? customRate : usdRate;
    if (!(rate > 0)) return null;
    return { factor: usd * rate, currency: "CNY" };
  }
  if (type === "USD" || type === "") {
    if (usdRate >= 5 && usdRate <= 12) return { factor: usd * usdRate, currency: "CNY" };
    return { factor: usd, currency: "USD" };
  }
  return null;
}

function modelsFrom(priceText, statusText) {
  const json = parseJson(priceText);
  const statusJson = parseJson(statusText);
  if (!json || json.success === false || !Array.isArray(json.data) || !json.data.length) return [];
  const unit = yuanPerRatio(statusJson?.data || {});
  const groupRatio = json.group_ratio && typeof json.group_ratio === "object" ? json.group_ratio : {};
  const models = [];
  for (const item of json.data) {
    if (!item?.model_name) continue;
    const name = String(item.model_name).trim().slice(0, 80);
    if (!name) continue;
    const groups = (Array.isArray(item.enable_groups) ? item.enable_groups : ["default"])
      .map((group) => String(group).trim())
      .filter((group) => group && !/管理员|内部测试/.test(group))
      .slice(0, 8);
    const list = groups.length ? groups : ["default"];
    const modelRatio = Number(item.model_ratio);
    const completion = Number(item.completion_ratio);
    const cacheRatio = Number(item.cache_ratio);
    const custom = String(item.billing_expr || "").trim();
    const tokenPriced = Number(item.quota_type) === 0 && Number.isFinite(modelRatio) && modelRatio > 0 && !custom;
    for (const group of list) {
      if (models.length >= 400) return models;
      const multiplier = Number(groupRatio[group]);
      const groupRate = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
      const ratio = tokenPriced ? Math.round(modelRatio * groupRate * 1e6) / 1e6 : (Number.isFinite(modelRatio) ? modelRatio : null);
      const row = { id: name, name, group: group.slice(0, 80), ratio };
      if (tokenPriced && unit) {
        const input = roundMoney(unit.factor * modelRatio * groupRate);
        row.input = input;
        row.output = input == null || !(completion > 0) ? null : roundMoney(input * completion);
        row.cache = input == null || !(cacheRatio > 0) ? null : roundMoney(input * cacheRatio);
        row.currency = unit.currency;
      }
      models.push(row);
    }
  }
  return models;
}

function noticeFrom(text) {
  let json;
  try { json = JSON.parse(text); } catch { return ""; }
  if (!json || json.success === false || typeof json.data !== "string") return "";
  const notice = json.data.replace(/\r/g, "").trim();
  if (notice.length < 12) return "";
  return notice.slice(0, 2500);
}

const stations = {};
let done = 0;
let priced = 0;
let noted = 0;
let withMoney = 0;
const jobs = [...byOrigin.values()];

async function work(job) {
  const [pricing, notice, status] = await Promise.all([
    getText(`${job.origin}/api/pricing`),
    getText(`${job.origin}/api/notice`),
    getText(`${job.origin}/api/status`),
  ]);
  const sameHost = (result) => result.status === 200 && result.host && result.host === job.host;
  const models = sameHost(pricing) ? modelsFrom(pricing.text, sameHost(status) ? status.text : "") : [];
  const text = sameHost(notice) ? noticeFrom(notice.text) : "";
  if (models.length || text) {
    const record = {};
    if (models.length) {
      record.models = models;
      priced += 1;
      if (models.some((model) => model.input != null)) withMoney += 1;
    }
    if (text) {
      record.notice = text;
      noted += 1;
    }
    for (const id of job.ids) stations[id] = record;
  }
  done += 1;
  if (done % 250 === 0) console.log(JSON.stringify({ done, total: jobs.length, priced, noted, withMoney }));
}

const queue = jobs.slice();
await Promise.all(Array.from({ length: 18 }, async () => {
  while (queue.length) await work(queue.shift());
}));

writeFileSync(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), stations }));
console.log(JSON.stringify({ done, origins: jobs.length, priced, noted, withMoney, ids: Object.keys(stations).length }));
